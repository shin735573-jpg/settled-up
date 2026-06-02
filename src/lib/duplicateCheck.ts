// 기록입력 저장 전 중복 검사 (순수 함수, 테스트 가능).
//  - 정확 중복: 날짜, 업체, 고객명, 품목, 배송합계, 착불, 팀장1, 팀장2,
//               분할, 결제유무, 비고까지 모두 일치
//  - 의심 중복: 날짜, 업체, 고객명, 품목, 배송합계만 일치

export type DupDelivery = {
  id?: string | null;
  date?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  region?: string | null;
  item?: string | null;
  metro_fee?: number | string | null;
  note_amount?: number | string | null;
  regional_fee?: number | string | null;
  cod_amount?: number | string | null;
  leader1_id?: string | null;
  leader2_id?: string | null;
  split_type?: string | null;
  two_person?: boolean | null;
  companion?: boolean | null;
  paid?: boolean | null;
  note?: string | null;
};

const num = (v: unknown) => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const norm = (v: unknown) => String(v ?? "").trim();
const totalFee = (d: DupDelivery) =>
  num(d.metro_fee) + num(d.note_amount) + num(d.regional_fee);
const companyKey = (d: DupDelivery) =>
  norm(d.company_id) || norm(d.company_name).toLowerCase();
const dateK = (d: DupDelivery) => norm(d.date).slice(0, 10);

export type DuplicateMatch = {
  id: string;
  date: string;
  company: string;
  customer: string;
  item: string;
  fee: number;
  cod: number;
};

const toMatch = (e: DupDelivery): DuplicateMatch => ({
  id: norm(e.id),
  date: dateK(e),
  company: norm(e.company_name),
  customer: norm(e.customer_name),
  item: norm(e.item),
  fee: totalFee(e),
  cod: num(e.cod_amount),
});

const baseMatch = (a: DupDelivery, b: DupDelivery) =>
  dateK(a) === dateK(b)
  && companyKey(a) === companyKey(b)
  && norm(a.customer_name) === norm(b.customer_name)
  && norm(a.region).toLowerCase() === norm(b.region).toLowerCase()
  && norm(a.item) === norm(b.item)
  && totalFee(a) === totalFee(b);

const sameId = (a: DupDelivery, b: DupDelivery) =>
  !!a.id && !!b.id && a.id === b.id;

export function findExactDuplicates(
  candidate: DupDelivery,
  existing: DupDelivery[],
): DuplicateMatch[] {
  return existing
    .filter((e) => !sameId(e, candidate))
    .filter((e) =>
      baseMatch(e, candidate)
      && num(e.cod_amount) === num(candidate.cod_amount)
      && num(e.metro_fee) === num(candidate.metro_fee)
      && num(e.note_amount) === num(candidate.note_amount)
      && num(e.regional_fee) === num(candidate.regional_fee)
      && norm(e.leader1_id) === norm(candidate.leader1_id)
      && norm(e.leader2_id) === norm(candidate.leader2_id)
      && norm(e.split_type) === norm(candidate.split_type)
      && !!e.two_person === !!candidate.two_person
      && !!e.paid === !!candidate.paid
    )
    .map(toMatch);
}

export function findSuspectDuplicates(
  candidate: DupDelivery,
  existing: DupDelivery[],
): DuplicateMatch[] {
  const exactSet = new Set(findExactDuplicates(candidate, existing).map((m) => m.id));
  return existing
    .filter((e) => !sameId(e, candidate))
    .filter((e) => baseMatch(e, candidate))
    .map(toMatch)
    .filter((m) => !exactSet.has(m.id));
}

export function formatDuplicateConfirm(
  exact: DuplicateMatch[],
  suspect: DuplicateMatch[],
): string {
  const lines: string[] = [];
  const fmt = (m: DuplicateMatch) =>
    `  - [${m.id.slice(0, 8)}] ${m.date} ${m.company || "?"} / ${m.customer || "?"} / ${m.item || "?"} / 배송 ${m.fee.toLocaleString()}원`;
  if (exact.length) {
    lines.push(`정확 중복 ${exact.length}건`);
    exact.slice(0, 5).forEach((m) => lines.push(fmt(m)));
    if (exact.length > 5) lines.push(`  … 외 ${exact.length - 5}건`);
  }
  if (suspect.length) {
    if (lines.length) lines.push("");
    lines.push(`의심 중복 ${suspect.length}건`);
    suspect.slice(0, 5).forEach((m) => lines.push(fmt(m)));
    if (suspect.length > 5) lines.push(`  … 외 ${suspect.length - 5}건`);
  }
  if (lines.length) {
    lines.push("");
    lines.push("그대로 저장하시겠습니까?");
  }
  return lines.join("\n");
}

export function hasAnyDuplicates(
  exact: DuplicateMatch[],
  suspect: DuplicateMatch[],
): boolean {
  return exact.length > 0 || suspect.length > 0;
}

// 대량 저장(엑셀 붙여넣기/여러건 저장) 전 중복 검사.
//  - 후보들끼리 서로 중복인 경우와 기존 데이터와의 중복을 함께 검사한다.
//  - 결과는 후보별이 아닌, 전체에서 발생한 정확/의심 중복의 합쳐진 매치 리스트.
//  - 중복 매치는 매치 id 기준으로 한 번만 카운트한다(같은 기존 행이 여러 후보와
//    충돌해도 1건으로 표시).
export function findBulkDuplicates(
  candidates: DupDelivery[],
  existing: DupDelivery[],
): { exact: DuplicateMatch[]; suspect: DuplicateMatch[] } {
  const exactMap = new Map<string, DuplicateMatch>();
  const suspectMap = new Map<string, DuplicateMatch>();
  const keyOf = (m: DuplicateMatch, i: number) =>
    m.id || `${m.date}|${m.company}|${m.customer}|${m.item}|${m.fee}|${m.cod}|${i}`;
  candidates.forEach((cand, idx) => {
    // 기존 데이터 + 자기 자신을 제외한 다른 후보들과 비교
    const others = candidates.filter((_, i) => i !== idx);
    const pool = [...existing, ...others];
    const ex = findExactDuplicates(cand, pool);
    const sus = findSuspectDuplicates(cand, pool);
    ex.forEach((m) => {
      const k = keyOf(m, idx);
      if (!exactMap.has(k)) exactMap.set(k, m);
    });
    sus.forEach((m) => {
      const k = keyOf(m, idx);
      if (!exactMap.has(k) && !suspectMap.has(k)) suspectMap.set(k, m);
    });
  });
  return { exact: [...exactMap.values()], suspect: [...suspectMap.values()] };
}

// 대량 저장 시 후보별 분류 — 완전 중복은 자동 제외, 유사 중복은 경고만.
//  - exactDupRows: 기존 또는 다른 후보와 완전 중복인 후보 (저장에서 제외 권장)
//  - suspectRows : 유사 중복이 발견된 후보 (사용자 확인 후 진행)
//  - newRows     : 중복 없는 신규 후보
export function summarizeBulk(
  candidates: DupDelivery[],
  existing: DupDelivery[],
): {
  total: number;
  newCount: number;
  exactDupCount: number;
  suspectCount: number;
  newRows: DupDelivery[];
  exactDupRows: DupDelivery[];
  suspectRows: DupDelivery[];
  exactMatches: DuplicateMatch[];
  suspectMatches: DuplicateMatch[];
} {
  const newRows: DupDelivery[] = [];
  const exactDupRows: DupDelivery[] = [];
  const suspectRows: DupDelivery[] = [];
  const exactMatches: DuplicateMatch[] = [];
  const suspectMatches: DuplicateMatch[] = [];
  // 후보가 자기들끼리 정확 중복이면 첫 번째 한 건만 신규로 두고 나머지는 exactDup
  const seenExact = new Set<string>();
  candidates.forEach((cand, idx) => {
    const others = candidates.filter((_, i) => i !== idx);
    const pool = [...existing, ...others];
    const ex = findExactDuplicates(cand, pool);
    const sus = findSuspectDuplicates(cand, pool);
    if (ex.length > 0) {
      // 후보끼리 정확 중복이라면 첫 번째는 신규로 살리고 나머지는 제외
      const sig = [
        cand.date, cand.company_id || cand.company_name, cand.customer_name,
        cand.region, cand.item, cand.metro_fee, cand.note_amount,
        cand.regional_fee, cand.cod_amount, cand.leader1_id, cand.leader2_id,
        cand.split_type, cand.two_person, cand.paid,
      ].join("|");
      const hasExistingExact = ex.some((m) => existing.find((e) => e.id === m.id));
      if (!hasExistingExact && !seenExact.has(sig)) {
        seenExact.add(sig);
        newRows.push(cand);
        return;
      }
      exactDupRows.push(cand);
      ex.forEach((m) => exactMatches.push(m));
      return;
    }
    if (sus.length > 0) {
      suspectRows.push(cand);
      sus.forEach((m) => suspectMatches.push(m));
    }
    newRows.push(cand);
  });
  return {
    total: candidates.length,
    newCount: newRows.length,
    exactDupCount: exactDupRows.length,
    suspectCount: suspectRows.length,
    newRows,
    exactDupRows,
    suspectRows,
    exactMatches,
    suspectMatches,
  };
}

// 관리자용: 로드된 배송 목록에서 "중복 의심" 그룹을 만든다.
//  - 그룹 키: 날짜|업체|고객|배송지|품목|배송합계 (의심 중복 기준)
//  - 2건 이상 모인 그룹만 반환
//  - 그룹 안에서 "정확 중복"인 행과 그렇지 않은 "의심" 행을 함께 표시
export type DuplicateGroup = {
  key: string;
  date: string;
  company: string;
  customer: string;
  region: string;
  item: string;
  fee: number;
  rows: DupDelivery[];
  exactPairs: number; // 그룹 내에서 서로 완전 중복인 쌍 수
};

export function groupSuspectDuplicates(rows: DupDelivery[]): DuplicateGroup[] {
  const map = new Map<string, DupDelivery[]>();
  const keyOf = (r: DupDelivery) => [
    String(r.date ?? "").slice(0, 10),
    String(r.company_id ?? r.company_name ?? "").toLowerCase().trim(),
    String(r.customer_name ?? "").trim(),
    String(r.region ?? "").toLowerCase().trim(),
    String(r.item ?? "").trim(),
    num(r.metro_fee) + num(r.note_amount) + num(r.regional_fee),
  ].join("|");
  for (const r of rows) {
    const k = keyOf(r);
    const arr = map.get(k) || [];
    arr.push(r);
    map.set(k, arr);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, rs] of map.entries()) {
    if (rs.length < 2) continue;
    // 정확 중복 쌍 수
    let pairs = 0;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        if (findExactDuplicates(rs[i], [rs[j]]).length > 0) pairs++;
      }
    }
    const first = rs[0];
    groups.push({
      key,
      date: String(first.date ?? "").slice(0, 10),
      company: String(first.company_name ?? ""),
      customer: String(first.customer_name ?? ""),
      region: String(first.region ?? ""),
      item: String(first.item ?? ""),
      fee: num(first.metro_fee) + num(first.note_amount) + num(first.regional_fee),
      rows: rs,
      exactPairs: pairs,
    });
  }
  // 정확중복 쌍 많은 순 → 날짜 내림차순
  groups.sort((a, b) => b.exactPairs - a.exactPairs || b.date.localeCompare(a.date));
  return groups;
}

// =============================================================
// 선택한 1건 기준 중복의심 검색 (기록입력 우측 패널용)
// =============================================================

export type SuspectStatus =
  | "exact"            // 완전 중복
  | "similar"          // 유사 중복
  | "note_similar"     // 비고 유사
  | "leader_missing"   // 팀장 누락 의심
  | "companion_candidate"   // 동행 통합 후보
  | "two_person_candidate"  // 2인배송 통합 후보
  | "two_person_mismatch"   // 2인배송 불일치
  | "companion_needed"      // 동행 확인 필요
  | "settlement_mismatch"   // 정산 불일치
  | "reference";       // 참고건(품목 다름 등)

export type RecommendedAction =
  | "merge_companion"
  | "merge_two_person"
  | "keep_separate"
  | "dedupe"
  | "none";

const normLower = (v: unknown) => norm(v).toLowerCase();
const dateOnly = (v: unknown) => norm(v).slice(0, 10);
const tokens = (s: string) => s.toLowerCase().split(/[\s,./|·\-_()[\]{}]+/).filter(Boolean);
const noteSimilarity = (a: string, b: string): number => {
  const sa = a.trim();
  const sb = b.trim();
  if (!sa && !sb) return 1;
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  if (sa.includes(sb) || sb.includes(sa)) return 0.8;
  const ta = new Set(tokens(sa));
  const tb = new Set(tokens(sb));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : inter / union;
};

// 핵심 그룹 기준: 날짜 + 고객 + 배송지 + 품목
const sameGroupKey = (a: DupDelivery, b: DupDelivery) =>
  dateOnly(a.date) === dateOnly(b.date)
  && normLower(a.customer_name) === normLower(b.customer_name)
  && normLower(a.region) === normLower(b.region)
  && normLower(a.item) === normLower(b.item);

// 비고유사 후보: 날짜+고객+배송지 같음 (품목은 다를 수도)
const sameLoosenedKey = (a: DupDelivery, b: DupDelivery) =>
  dateOnly(a.date) === dateOnly(b.date)
  && normLower(a.customer_name) === normLower(b.customer_name)
  && normLower(a.region) === normLower(b.region);

export type SuspectSearchResult = {
  exact: DupDelivery[];
  similar: DupDelivery[];
  noteSimilar: DupDelivery[];
  reference: DupDelivery[]; // 고객/배송지 같지만 품목 다름
};

export function findDuplicateSuspects(
  base: DupDelivery,
  all: DupDelivery[],
): SuspectSearchResult {
  const out: SuspectSearchResult = { exact: [], similar: [], noteSimilar: [], reference: [] };
  for (const r of all) {
    if (sameId(r, base)) continue;
    if (dateOnly(r.date) !== dateOnly(base.date)) continue;
    // 같은 그룹(품목까지 같음)
    if (sameGroupKey(r, base)) {
      const fullExact = findExactDuplicates(base, [r]).length > 0;
      if (fullExact) { out.exact.push(r); continue; }
      // 다른 필드 1개 이상 다름 → similar
      out.similar.push(r);
      continue;
    }
    // 품목 다른 경우: 고객+배송지 같으면 참고건
    if (sameLoosenedKey(r, base)) {
      // 비고가 부분 유사하면 noteSimilar로 격상
      const sim = noteSimilarity(norm(r.note), norm(base.note));
      if (sim >= 0.5) out.noteSimilar.push(r);
      else out.reference.push(r);
    }
  }
  return out;
}

export function classifySuspect(base: DupDelivery, suspect: DupDelivery): SuspectStatus[] {
  const tags: SuspectStatus[] = [];
  const isExact = findExactDuplicates(base, [suspect]).length > 0;
  if (isExact) tags.push("exact");
  const grouped = sameGroupKey(base, suspect);
  const loose = sameLoosenedKey(base, suspect);
  if (!grouped && loose) tags.push("reference");
  if (grouped && !isExact) tags.push("similar");
  if (!grouped && loose) {
    const sim = noteSimilarity(norm(base.note), norm(suspect.note));
    if (sim >= 0.5) tags.push("note_similar");
  }
  // 팀장 관련
  const baseL1 = norm(base.leader1_id);
  const baseL2 = norm(base.leader2_id);
  const susL1 = norm(suspect.leader1_id);
  const susL2 = norm(suspect.leader2_id);
  if (grouped) {
    if ((!baseL2 && susL1 && susL1 !== baseL1) || (!susL2 && baseL1 && baseL1 !== susL1)) {
      tags.push("leader_missing");
    }
    // 팀장만 다른 경우: 통합 후보
    if (baseL1 !== susL1 || baseL2 !== susL2) {
      if (norm(base.split_type) === "반반" || norm(suspect.split_type) === "반반") {
        tags.push("two_person_candidate");
      } else {
        tags.push("companion_candidate");
      }
    }
    if (!!base.two_person !== !!suspect.two_person) tags.push("two_person_mismatch");
    if (!!base.companion !== !!suspect.companion) tags.push("companion_needed");
    // 정산 불일치: 반반이라면서 팀장2가 없음
    const needsLeader2 = norm(base.split_type) === "반반" || !!base.two_person;
    if (needsLeader2 && !baseL2) tags.push("settlement_mismatch");
  }
  return tags;
}

export function recommendAction(base: DupDelivery, suspect: DupDelivery): RecommendedAction {
  const tags = classifySuspect(base, suspect);
  if (tags.includes("exact")) return "dedupe";
  if (tags.includes("two_person_candidate")) return "merge_two_person";
  if (tags.includes("companion_candidate")) return "merge_companion";
  if (tags.includes("similar") || tags.includes("note_similar")) return "keep_separate";
  return "none";
}

export const SUSPECT_STATUS_LABEL: Record<SuspectStatus, string> = {
  exact: "완전 중복",
  similar: "유사 중복",
  note_similar: "비고 유사",
  leader_missing: "팀장 누락 의심",
  companion_candidate: "동행 통합 후보",
  two_person_candidate: "2인배송 통합 후보",
  two_person_mismatch: "2인배송 불일치",
  companion_needed: "동행 확인 필요",
  settlement_mismatch: "정산 불일치",
  reference: "참고건",
};

// 통합 시 금액 자동 합산
export type MergedAmounts = {
  metro_fee: number;
  note_amount: number;
  regional_fee: number;
  cod_amount: number;
  total: number;
};

export function sumMergedAmounts(rows: DupDelivery[]): MergedAmounts {
  const metro = rows.reduce((s, r) => s + num(r.metro_fee), 0);
  const note = rows.reduce((s, r) => s + num(r.note_amount), 0);
  const regional = rows.reduce((s, r) => s + num(r.regional_fee), 0);
  const cod = rows.reduce((s, r) => s + num(r.cod_amount), 0);
  return {
    metro_fee: metro,
    note_amount: note,
    regional_fee: regional,
    cod_amount: cod,
    total: metro + note + regional,
  };
}

// 최종 저장 전 검증
export type MergeValidationError = { id?: string; message: string; level: "error" | "warning" };

export type MergePlanItem = {
  base: DupDelivery;        // 수정 대상(기존 row)
  next: DupDelivery;        // 적용할 값
  action: "merge_companion" | "merge_two_person" | "keep_separate" | "edit";
  amountMode?: "sum" | "manual";
  manualTotal?: number | null;
};

export function validateMergePlan(items: MergePlanItem[]): MergeValidationError[] {
  const errors: MergeValidationError[] = [];
  for (const it of items) {
    const { next, action, amountMode, manualTotal } = it;
    const id = norm(it.base.id) || undefined;
    if (action === "merge_two_person") {
      if (!norm(next.leader2_id)) errors.push({ id, message: "2인배송 통합인데 팀장2가 없습니다.", level: "error" });
      if (!next.two_person) errors.push({ id, message: "2인배송 통합인데 2인배송 여부가 꺼져 있습니다.", level: "error" });
    }
    if (norm(next.split_type) === "반반" && !norm(next.leader2_id)) {
      errors.push({ id, message: "반반 정산인데 팀장2가 없습니다.", level: "error" });
    }
    if (action === "merge_companion" && !next.companion) {
      errors.push({ id, message: "동행 통합인데 동행여부가 꺼져 있습니다.", level: "error" });
    }
    if ((action === "merge_two_person" || action === "merge_companion") && !amountMode) {
      errors.push({ id, message: "금액 처리 방식(합산/직접입력)을 선택해주세요.", level: "error" });
    }
    if (amountMode === "manual" && (manualTotal == null || !Number.isFinite(Number(manualTotal)))) {
      errors.push({ id, message: "직접입력 청구금액이 비어 있습니다.", level: "error" });
    }
    if (!!next.two_person && norm(next.split_type) === "반반") {
      const total = num(next.metro_fee) + num(next.note_amount) + num(next.regional_fee);
      if (amountMode === "manual" && manualTotal != null && Math.abs(Number(manualTotal) - total) > 0.5) {
        // 직접입력은 허용하지만 계산 합과 다르면 경고
        errors.push({ id, message: `청구금액(${manualTotal})과 자동합산(${total})이 다릅니다.`, level: "warning" });
      }
    }
  }
  return errors;
}

// Postgres 23505 → 한국어 메시지
export function mapDuplicateError(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error) return null;
  if (error.code === "23505" || /duplicate key|dedupe_key|unique/.test(String(error.message || ""))) {
    return "이미 동일한 내용의 배송 기록이 있어 저장할 수 없습니다. (날짜·고객·배송지·품목·비고·금액·팀장 모두 같음)";
  }
  return null;
}
