// 기록 비교/통합 워크플로우용 순수 함수 라이브러리.
// 정산 로직과 무관. 분류/태깅/그룹 정리에만 사용한다.

export type GroupRow = {
  id: string;
  date?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  region?: string | null;
  item?: string | null;
  leader1_id?: string | null;
  leader1_name?: string | null;
  leader2_id?: string | null;
  leader2_name?: string | null;
  metro_fee?: number | string | null;
  note_amount?: number | string | null;
  regional_fee?: number | string | null;
  cod_amount?: number | string | null;
  split_type?: string | null;
  two_person?: boolean | null;
  companion?: boolean | null;
  companion_reason?: string | null;
  paid?: boolean | null;
  note?: string | null;
};

export type RowStatus =
  | "normal"
  | "exact_duplicate"
  | "suspect_duplicate"
  | "leader2_missing"
  | "two_person_mismatch"
  | "companion_needed";

export type RecommendedAction =
  | "dedupe"
  | "merge_companion"
  | "merge_two_person"
  | "keep_separate";

export type LooseGroup = {
  key: string;
  date: string;
  customer: string;
  region: string;
  item: string;
  rows: GroupRow[];
};

const num = (v: unknown) => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const s = (v: unknown) => String(v ?? "").trim();
const sl = (v: unknown) => s(v).toLowerCase();

export const totalFee = (r: GroupRow) =>
  num(r.metro_fee) + num(r.note_amount) + num(r.regional_fee);

export const looseKey = (r: GroupRow) =>
  [s(r.date).slice(0, 10), sl(r.customer_name), sl(r.region), sl(r.item)].join("|");

export const exactKey = (r: GroupRow) =>
  [
    looseKey(r),
    s(r.leader1_id),
    s(r.leader2_id),
    num(r.metro_fee),
    num(r.note_amount),
    num(r.regional_fee),
    num(r.cod_amount),
    r.two_person ? 1 : 0,
    r.companion ? 1 : 0,
    s(r.split_type),
    r.paid ? 1 : 0,
  ].join("|");

// 묶음 후보(=느슨한 키 동일) 그룹화. 단건은 제외(2건 이상만).
export function groupByLooseKey(rows: GroupRow[]): LooseGroup[] {
  const m = new Map<string, GroupRow[]>();
  for (const r of rows) {
    if (!s(r.customer_name) || !s(r.item)) continue;
    const k = looseKey(r);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  const out: LooseGroup[] = [];
  for (const [key, rs] of m.entries()) {
    if (rs.length < 2) continue;
    const first = rs[0];
    out.push({
      key,
      date: s(first.date).slice(0, 10),
      customer: s(first.customer_name),
      region: s(first.region),
      item: s(first.item),
      rows: rs,
    });
  }
  // 최신 날짜 우선
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

// 한 행을 상태로 분류. 같은 그룹 안 다른 행들을 함께 본다.
export function classifyGroupRow(row: GroupRow, group: GroupRow[]): RowStatus[] {
  const tags: RowStatus[] = [];
  const others = group.filter((r) => r.id !== row.id);
  const ekey = exactKey(row);
  const hasExact = others.some((r) => exactKey(r) === ekey);
  if (hasExact) tags.push("exact_duplicate");
  else if (others.length > 0) tags.push("suspect_duplicate");

  if (row.two_person && !s(row.leader2_id)) tags.push("two_person_mismatch");
  if (!row.two_person && s(row.leader2_id) && !row.companion) tags.push("companion_needed");
  if (s(row.split_type) === "반반" && !s(row.leader2_id)) tags.push("leader2_missing");
  // 다른 행에는 팀장2가 있는데 본인은 없으면 누락 의심
  if (!s(row.leader2_id) && others.some((r) => s(r.leader2_id))) {
    if (!tags.includes("leader2_missing")) tags.push("leader2_missing");
  }
  if (tags.length === 0) tags.push("normal");
  return tags;
}

export function recommendAction(group: GroupRow[]): RecommendedAction {
  if (group.length < 2) return "keep_separate";
  const keys = group.map(exactKey);
  if (new Set(keys).size < keys.length) return "dedupe";
  const splits = group.map((r) => s(r.split_type));
  if (splits.some((x) => x === "반반")) return "merge_two_person";
  const leaders1 = new Set(group.map((r) => s(r.leader1_id)).filter(Boolean));
  if (leaders1.size >= 2) return "merge_companion";
  return "keep_separate";
}

export type MergePlanItem = {
  groupKey: string;
  action: RecommendedAction;
  // 일괄 적용에 사용할 값 (옵션)
  leader2Id?: string | null;
  companionReason?: string;
  splitType?: string | null;
  // 적용 대상 행 ids (보통 그룹 전체)
  targetIds: string[];
};

export type ValidationIssue = {
  rowId?: string;
  groupKey: string;
  message: string;
  severity: "error" | "warn";
};

// 저장 전 검증. action별 후처리 결과가 비즈니스 규칙을 깨지 않는지 검사.
export function validateMergePlan(
  plan: MergePlanItem[],
  groupsByKey: Map<string, GroupRow[]>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const p of plan) {
    const rows = groupsByKey.get(p.groupKey) ?? [];
    if (p.action === "merge_two_person") {
      // 팀장2는 그룹 내 다른 행의 팀장1로 자동 추론하므로 별도 검증 없음
    }
    // 동행 통합은 사유 입력 없이 진행
    // 그룹 내 완전 중복이 남아있으면 경고
    const keys = rows.map(exactKey);
    if (new Set(keys).size < keys.length && p.action !== "dedupe") {
      issues.push({
        groupKey: p.groupKey,
        message: "그룹 안에 완전 중복이 남아 있습니다. 중복 제거가 필요합니다.",
        severity: "error",
      });
    }
  }
  return issues;
}

// 액션을 실제 DB update payload로 변환 (id별 patch)
export function buildUpdatePatches(
  plan: MergePlanItem[],
  groupsByKey: Map<string, GroupRow[]>,
): { patches: Array<{ id: string; patch: Partial<GroupRow> }>; deleteIds: string[] } {
  const out: Array<{ id: string; patch: Partial<GroupRow> }> = [];
  const deletes: string[] = [];
  for (const p of plan) {
    const rows = groupsByKey.get(p.groupKey) ?? [];
    if (p.action === "keep_separate") continue;
    if (p.action === "dedupe") continue; // 삭제는 별도 흐름
    // 통합 = 2개 이상이 1개로 합쳐짐. 첫 행을 기준으로 남기고 나머지는 삭제.
    const targets = rows.filter((r) => p.targetIds.includes(r.id));
    if (targets.length === 0) continue;
    const baseRow = targets[0];
    const others = targets.slice(1);
    const patch: Partial<GroupRow> = {};
    // 금액 합산 (통합 후 최종 청구금액)
    const sumField = (k: keyof GroupRow) =>
      targets.reduce((acc, r) => acc + num(r[k]), 0);
    patch.metro_fee = sumField("metro_fee");
    patch.note_amount = sumField("note_amount");
    patch.regional_fee = sumField("regional_fee");
    patch.cod_amount = sumField("cod_amount");
    if (p.action === "merge_companion") {
      patch.companion = true;
      patch.two_person = false;
    } else if (p.action === "merge_two_person") {
      patch.two_person = true;
      patch.companion = false;
      if (!s(baseRow.leader2_id)) {
        const leaderIds = Array.from(
          new Set(targets.map((r) => s(r.leader1_id)).filter(Boolean)),
        );
        const base = s(baseRow.leader1_id);
        const autoLeader2 = leaderIds.find((id) => id !== base) ?? null;
        const l2 = s(p.leader2Id) || autoLeader2;
        if (l2) patch.leader2_id = l2;
      }
      if (!s(baseRow.split_type)) patch.split_type = "반반";
    }
    out.push({ id: baseRow.id, patch });
    for (const r of others) deletes.push(r.id);
  }
  return { patches: out, deleteIds: deletes };
}

export const statusLabel: Record<RowStatus, string> = {
  normal: "정상",
  exact_duplicate: "완전 중복",
  suspect_duplicate: "유사 중복",
  leader2_missing: "팀장2 누락 의심",
  two_person_mismatch: "2인배송 불일치",
  companion_needed: "동행 확인 필요",
};

export const actionLabel: Record<RecommendedAction, string> = {
  dedupe: "중복 제거 추천",
  merge_companion: "동행 통합 추천",
  merge_two_person: "2인배송 통합 추천",
  keep_separate: "별도 유지",
};