// 배송 기록 종합 오류 검사 엔진 (순수 함수)
// React/Supabase 의존성 없음 — 테스트 가능

import { allocateRow } from "./splitAllocation";
import { isSpecialOneTimeItem } from "./statementData";

export type Severity = "error" | "warning";

export type ValidationIssue = {
  rowId: string;          // 행 식별자 (저장된 레코드 id 또는 미리보기 idx)
  rowLabel?: string;      // 사용자에게 보일 행 라벨 ("12행", "엑셀 3행")
  code: string;           // missing.date, amount.negative ...
  field?: string;
  severity: Severity;
  message: string;
};

export type DeliveryRecord = {
  id: string;
  date: string | null;
  company_id: string | null;
  company_name: string | null;
  leader1_id: string | null;
  leader1_name: string | null;
  leader2_id: string | null;
  leader2_name: string | null;
  leader3_id?: string | null;
  leader3_name?: string | null;
  customer_name: string | null;
  region: string | null;
  region_type: "metro" | "regional" | null;
  item: string | null;
  note: string | null;
  metro_fee: number | string | null;
  note_amount: number | string | null;
  regional_fee: number | string | null;
  cod_amount: number | string | null;
  split_type: string | null;
  paid: boolean | null;
  two_person?: boolean | null;
  is_missing?: boolean;
};

export type CompanyRef = { id: string; name: string };
export type LeaderRef = {
  id: string;
  name: string;
  is_rejected?: boolean;
  is_virtual?: boolean;
  active?: boolean;
  aliases?: string[] | null;
  settle_to_id?: string | null;
};
export type HolidayRef = { date: string; scope: "hq" | "leader" | string; team_leader_id: string | null };

export type ValidationContext = {
  companies: CompanyRef[];
  leaders: LeaderRef[];
  holidays: HolidayRef[];
  // 배송지 → metro/regional 분류 함수 (UI에 정의된 것 주입)
  classifyRegion?: (text: string) => "metro" | "regional" | "unknown";
  // 업체별 거부팀장 매핑 (선택)
  rejectedLeadersOfCompany?: (companyId: string | null) => string[];
};

const SPLIT_ALLOWED = ["", "3분할", "형주동석"];
const isNumLike = (v: unknown): { ok: boolean; n: number } => {
  if (v === null || v === undefined || v === "") return { ok: true, n: 0 };
  if (typeof v === "number") return { ok: Number.isFinite(v), n: v };
  const cleaned = String(v).replace(/,/g, "").trim();
  if (cleaned === "") return { ok: true, n: 0 };
  const n = Number(cleaned);
  return { ok: !isNaN(n) && isFinite(n), n };
};

/** 한 행 검사 — 1~12번 룰 (#13 기간 총액은 별도 함수) */
export function validateRow(
  r: DeliveryRecord,
  ctx: ValidationContext,
  rowLabel?: string,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const push = (severity: Severity, code: string, message: string, field?: string) =>
    out.push({ rowId: r.id, rowLabel, code, message, severity, field });

  // 1. 필수값
  if (!r.date) push("error", "missing.date", "날짜 누락", "날짜");
  if (!r.company_id && !r.company_name) push("error", "missing.company", "업체 누락", "업체");
  if (!r.leader1_id && !r.leader1_name) push("error", "missing.leader1", "팀장1 누락", "팀장1");
  if (!r.customer_name) push("error", "missing.customer", "고객명 누락", "고객명");
  if (!r.item) push("error", "missing.item", "품목 누락", "품목");

  // 2. 금액
  const fields: [keyof DeliveryRecord, string][] = [
    ["metro_fee", "수도권배송비"],
    ["note_amount", "비고금액"],
    ["regional_fee", "지방배송비"],
    ["cod_amount", "착불"],
  ];
  const nums: Record<string, number> = {};
  for (const [k, label] of fields) {
    const chk = isNumLike(r[k] as unknown);
    if (!chk.ok) push("error", "amount.invalid", `${label}: 숫자 아님 (${String(r[k])})`, label);
    else if (chk.n < 0) push("error", "amount.negative", `${label}: 음수 불가 (${chk.n})`, label);
    nums[k as string] = chk.ok ? chk.n : 0;
  }

  // 3. 배송비총액 (= metro + noteAmt + regional). 자동 계산이므로 보통 일치하지만
  //    음수 등 비정상 합계를 추가로 확인.
  const sum = nums["metro_fee"] + nums["note_amount"] + nums["regional_fee"];
  if (sum < 0) push("error", "amount.total.negative", `배송비총액 음수: ${sum}`, "배송비총액");

  // 3-1. 행사철수 등 특수일: 수도권/지방 배송비는 업체 청구에서 무시됨
  if (isSpecialOneTimeItem(r.item) && (nums["metro_fee"] > 0 || nums["regional_fee"] > 0)) {
    push(
      "warning",
      "special.fee.ignored",
      `${r.item}: 수도권/지방 배송비는 업체 청구 시 무시되고 비고금액만 합산됩니다`,
      "배송비총액",
    );
  }

  // 4. 업체 등록 검사
  if (r.company_id) {
    const found = ctx.companies.find((c) => c.id === r.company_id);
    if (!found) push("warning", "company.unregistered", `미등록 업체 id: ${r.company_id}`, "업체");
  } else if (r.company_name) {
    const found = ctx.companies.find((c) => c.name.trim() === r.company_name!.trim());
    if (!found) push("warning", "company.unregistered", `미등록 업체: ${r.company_name}`, "업체");
  }

  // 5. 팀장 등록 검사 (팀장2 빈칸은 오류 아님)
  const leaderById = new Map(ctx.leaders.map((l) => [l.id, l] as const));
  const leaderByName = new Map(ctx.leaders.map((l) => [l.name.trim(), l] as const));
  const checkLeader = (idVal: string | null, nameVal: string | null, label: string) => {
    if (!idVal && !nameVal) return null;
    if (idVal && leaderById.has(idVal)) return leaderById.get(idVal)!;
    if (nameVal && leaderByName.has(nameVal.trim())) return leaderByName.get(nameVal.trim())!;
    push("warning", "leader.unregistered", `미등록 ${label}: ${nameVal || idVal}`, label);
    return null;
  };
  const l1 = checkLeader(r.leader1_id, r.leader1_name, "팀장1");
  const l2 = r.leader2_id || r.leader2_name ? checkLeader(r.leader2_id, r.leader2_name, "팀장2") : null;
  const l3 = r.leader3_id || r.leader3_name ? checkLeader(r.leader3_id ?? null, r.leader3_name ?? null, "팀장3") : null;

  // 6. 지역구분
  if (r.region && r.region_type && ctx.classifyRegion) {
    const auto = ctx.classifyRegion(r.region);
    if (auto !== "unknown" && auto !== r.region_type) {
      push("warning", "region.mismatch",
        `지역구분 불일치: 자동(${auto}) vs 입력(${r.region_type})`, "지역구분");
    }
  }

  // 7. 결제유무
  if (r.paid !== true && r.paid !== false && r.paid !== null && r.paid !== undefined) {
    push("error", "paid.invalid", `결제유무 허용값 아님: ${String(r.paid)}`, "결제유무");
  }

  // 8. 분할 허용값
  const splitVal = (r.split_type ?? "").trim();
  if (!SPLIT_ALLOWED.includes(splitVal)) {
    push("error", "split.invalid", `분할 허용값 아님: ${splitVal}`, "분할");
  }

  // 9. 3분할 시 팀장 두 명 필수
  if (splitVal === "3분할") {
    if (!l1) push("error", "split.3.leader1", "3분할인데 팀장1 누락", "팀장1");
    if (!l2 && !r.leader2_id && !r.leader2_name)
      push("error", "split.3.leader2", "3분할인데 팀장2 누락", "팀장2");
    // 9-1. 신동석 + 3분할 충돌 경고
    const involvesShindongseok =
      (l1?.name?.trim() === "신동석") ||
      (l2?.name?.trim() === "신동석") ||
      (r.leader1_name?.trim() === "신동석") ||
      (r.leader2_name?.trim() === "신동석");
    if (involvesShindongseok) {
      push("warning", "split.3.shindongseok",
        "신동석이 포함된 건에 3분할이 선택됨 — 신동석 재분배 규칙과 충돌. 분할 선택을 확인하세요.",
        "분할");
    }
  }

  // 10. 거부팀장 검사
  const rejectedList = ctx.rejectedLeadersOfCompany?.(r.company_id) || [];
  const rejectedSet = new Set(rejectedList);
  [l1, l2, l3].forEach((lx, i) => {
    if (!lx) return;
    if (lx.is_rejected || rejectedSet.has(lx.id)) {
      const hasAlias = !!(lx as any).aliases?.[0];
      const msg = hasAlias
        ? `거부기사 배정 (${lx.name}) → 업체 표시 별칭 적용`
        : `거부기사 배정 (${lx.name}) → 별칭 미등록: 팀장관리에서 별칭을 입력하세요`;
      push("warning", "leader.rejected", msg, `팀장${i + 1}`);
    }
  });

  // 11. 휴무일
  if (r.date) {
    const hqOff = ctx.holidays.find((h) => h.scope === "hq" && h.date === r.date);
    if (hqOff) push("error", "holiday.hq", `본사 휴무일 (${r.date})`, "날짜");
    [l1, l2, l3].forEach((lx, i) => {
      if (!lx) return;
      const off = ctx.holidays.find(
        (h) => h.scope === "leader" && h.date === r.date && h.team_leader_id === lx.id);
      if (off) push("error", "holiday.leader", `${lx.name} 휴무일`, `팀장${i + 1}`);
    });
    // 일요일 경고 (본사 휴무일이 아닐 때만)
    const d = new Date(r.date + "T00:00:00");
    if (!isNaN(d.getTime()) && d.getDay() === 0 && !hqOff) {
      push("warning", "holiday.sunday", "일요일 배송입니다. 확인 후 저장하세요.", "날짜");
    }
  }

  return out;
}

// ────────────────────────────────────────────────────
// 정산귀속(settle_to_id) 검사 — 오은규 → 오동선 같은 특수정산
//  - 귀속 대상 팀장(L)이 포함된 행에서 allocateRow가 L에게 몫을 만들고,
//    그 몫이 정산기사(T = L.settle_to_id)에 합산될 수 있어야 함.
//  - L이 다른 팀장(T)에게 귀속됐는데 T가 존재하지 않으면 오류.
//  - 같은 행에 L과 T가 동시에 등장해도 중복 계산되지 않아야 함
//    (allocateRow는 weight를 분배하므로 자동 보장; 합이 행 총액을 초과하면 오류).
// ────────────────────────────────────────────────────

export function validateSettleRedirect(
  rows: DeliveryRecord[],
  ctx: ValidationContext,
  labelOf?: (r: DeliveryRecord, idx: number) => string,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const byId = new Map(ctx.leaders.map((l) => [l.id, l] as const));
  // 귀속 매핑이 있는 팀장 목록 (L → T)
  const redirects = ctx.leaders.filter((l) => l.settle_to_id);
  if (redirects.length === 0) return out;

  // 1) 매핑 자체의 유효성: T가 존재해야 함
  for (const l of redirects) {
    const t = l.settle_to_id ? byId.get(l.settle_to_id) : undefined;
    if (!t) {
      out.push({
        rowId: `__settle_to__:${l.id}`,
        code: "settle.target.missing",
        severity: "error",
        message: `팀장 "${l.name}"의 정산귀속 대상이 등록되어 있지 않습니다`,
      });
    }
  }

  // 2) 행 단위 — 귀속 대상 팀장이 포함된 행에서 합산 정합성
  const redirectIds = new Set(redirects.map((l) => l.id));
  const { ganghyungjuId, shindongseokId } = findTeamIds(ctx.leaders);

  rows.forEach((r, i) => {
    const rowLabel = labelOf ? labelOf(r, i) : `행 ${i + 1}`;
    const ids = [r.leader1_id, r.leader2_id, r.leader3_id].filter(Boolean) as string[];
    const involved = ids.find((id) => redirectIds.has(id));
    if (!involved) return;
    const L = byId.get(involved)!;
    const T = L.settle_to_id ? byId.get(L.settle_to_id) : undefined;
    if (!T) return; // 위에서 별도로 보고됨

    const shares = allocateRow(
      {
        leader1_id: r.leader1_id,
        leader2_id: r.leader2_id,
        leader3_id: r.leader3_id ?? null,
        split_type: r.split_type,
        two_person: r.two_person ?? false,
        metro_fee: isNumLike(r.metro_fee).n,
        note_amount: isNumLike(r.note_amount).n,
        regional_fee: isNumLike(r.regional_fee).n,
        cod_amount: isNumLike(r.cod_amount).n,
      },
      { ganghyungjuId, shindongseokId },
    );

    const lShare = shares.find((s) => s.leader_id === L.id);
    if (!lShare || lShare.weight <= 0) {
      out.push({
        rowId: r.id,
        rowLabel,
        code: "settle.redirect.missing",
        severity: "error",
        message: `${L.name} 관련 건이지만 배분이 누락 — ${T.name} 정산에 합산되지 못함`,
      });
      return;
    }
    // 행 총액 vs (L + T) 몫 합 — 중복 계산되면 행 총액 초과
    const rowTotal = isNumLike(r.metro_fee).n + isNumLike(r.note_amount).n + isNumLike(r.regional_fee).n;
    const tShare = shares.find((s) => s.leader_id === T.id);
    const merged =
      (lShare.metro + lShare.note_amount + lShare.regional) +
      ((tShare?.metro ?? 0) + (tShare?.note_amount ?? 0) + (tShare?.regional ?? 0));
    if (merged > rowTotal + 0.5) {
      out.push({
        rowId: r.id,
        rowLabel,
        code: "settle.redirect.double",
        severity: "error",
        message: `${L.name}+${T.name} 합산(${Math.round(merged)})이 행 총액(${Math.round(rowTotal)})을 초과 — 중복 계산 의심`,
      });
    }
  });

  return out;
}

/** 중복 의심 검사 (#12) — 행 묶음 비교 */
export function detectDuplicates(rows: DeliveryRecord[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const seen = new Map<string, DeliveryRecord>();
  for (const r of rows) {
    const total =
      (isNumLike(r.metro_fee).n) +
      (isNumLike(r.note_amount).n) +
      (isNumLike(r.regional_fee).n);
    const key = [
      r.date || "",
      (r.company_id || r.company_name || "").trim(),
      (r.customer_name || "").trim(),
      (r.item || "").trim(),
      total,
    ].join("|");
    const prev = seen.get(key);
    if (prev) {
      out.push({
        rowId: r.id,
        code: "duplicate.suspect",
        severity: "warning",
        message: `중복 의심 (이전 행 id=${prev.id})`,
      });
    } else {
      seen.set(key, r);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────
// #13 업체 총액 vs 팀장 총액 일치 검사 (기간별)
// 비교 기준: 배송비총액 = metro + noteAmt + regional
// 착불/수수료/공제/결제/적재/부가세 제외
// ────────────────────────────────────────────────────

export type PeriodKey = "1-15" | "16-end" | "month";

export function periodRange(yearMonth: string, key: PeriodKey): { start: string; end: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  if (key === "1-15") return { start: `${yearMonth}-01`, end: `${yearMonth}-15` };
  if (key === "16-end") return { start: `${yearMonth}-16`, end: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
  return { start: `${yearMonth}-01`, end: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

export type PeriodTotalsCheck = {
  period: PeriodKey;
  companyTotal: number;
  leaderTotal: number;
  diff: number;
  status: "정상" | "불일치";
};

/** 동일 기록 모집합에서 회사 기준 합계와 팀장 기준 합계를 비교.
 *  - 회사 기준: 각 배송의 (metro+noteAmt+regional)의 합
 *  - 팀장 기준: 동일하지만 팀장1이 없는 건은 제외(미배정으로 간주)
 *  → 일반적으로 둘은 같아야 함. 차이 = 미배정 누락. */
export function comparePeriodTotals(
  rows: DeliveryRecord[],
  yearMonth: string,
): PeriodTotalsCheck[] {
  const keys: PeriodKey[] = ["1-15", "16-end", "month"];
  return keys.map((k) => {
    const { start, end } = periodRange(yearMonth, k);
    const inRange = rows.filter((r) => r.date && r.date >= start && r.date <= end);
    const total = (r: DeliveryRecord) =>
      isNumLike(r.metro_fee).n + isNumLike(r.note_amount).n + isNumLike(r.regional_fee).n;
    const companyTotal = inRange.reduce((s, r) => s + total(r), 0);
    const leaderTotal = inRange
      .filter((r) => r.leader1_id || r.leader1_name)
      .reduce((s, r) => s + total(r), 0);
    const diff = companyTotal - leaderTotal;
    return {
      period: k,
      companyTotal,
      leaderTotal,
      diff,
      status: diff === 0 ? "정상" : "불일치",
    };
  });
}

/** 전체 검사 진입점: 행별 + 중복 검사를 모두 수행 */
export function validateAll(
  rows: DeliveryRecord[],
  ctx: ValidationContext,
  labelOf?: (r: DeliveryRecord, idx: number) => string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  rows.forEach((r, i) => {
    const label = labelOf ? labelOf(r, i) : `행 ${i + 1}`;
    issues.push(...validateRow(r, ctx, label));
  });
  issues.push(...detectDuplicates(rows));
  issues.push(...validateTeamParity(rows, ctx, labelOf));
  issues.push(...validateSettleRedirect(rows, ctx, labelOf));
  return issues;
}

export function summarize(issues: ValidationIssue[], totalRows: number) {
  const errorRows = new Set(issues.filter((i) => i.severity === "error").map((i) => i.rowId));
  const warnRows = new Set(
    issues.filter((i) => i.severity === "warning").map((i) => i.rowId),
  );
  // 정상 = 어떤 이슈도 없는 행
  const errorCount = errorRows.size;
  const warningCount = Array.from(warnRows).filter((id) => !errorRows.has(id)).length;
  const okCount = Math.max(0, totalRows - errorRows.size - warningCount);
  return { totalRows, errorCount, warningCount, okCount };
}

// ────────────────────────────────────────────────────
// 강형주 / 신동석 팀 정산 정합성 검사
// 두 팀장은 한 팀이므로 모든 형주/동석 관련 배송에서:
//  - 건수가 항상 동일해야 함
//  - 배송비 기준금액(metro/note/regional/cod)이 항상 동일해야 함
//  - 한 명에게 100%, 다른 한 명 0% 같은 비대칭이 발생하면 안 됨
// ────────────────────────────────────────────────────

const teamNameMatch = (name: string | null | undefined, aliases?: string[] | null) => {
  const n = String(name ?? "").trim();
  if (!n) return false;
  if (n === "강형주" || n === "신동석" || n === "형주" || n === "동석") return true;
  if (aliases && aliases.some((a) => ["형주", "동석"].includes(String(a ?? "").trim()))) return true;
  return false;
};

/** ctx.leaders 에서 강형주/신동석 id 찾기 (정식명 또는 별칭 형주/동석). */
function findTeamIds(leaders: LeaderRef[]): { ganghyungjuId: string | null; shindongseokId: string | null } {
  let g: string | null = null;
  let s: string | null = null;
  for (const l of leaders) {
    const nm = (l.name || "").trim();
    const al = (l.aliases || []).map((a) => (a || "").trim());
    if (!g && (nm === "강형주" || al.includes("형주"))) g = l.id;
    if (!s && (nm === "신동석" || al.includes("동석"))) s = l.id;
  }
  return { ganghyungjuId: g, shindongseokId: s };
}

const approxEq = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

/**
 * 강형주 vs 신동석 팀 배송 정합성을 검사.
 * - 두 사람 모두 ctx.leaders에 존재할 때만 동작.
 * - 행 단위 비대칭 + 전체 합계 비교 두 가지를 모두 리포트.
 */
export function validateTeamParity(
  rows: DeliveryRecord[],
  ctx: ValidationContext,
  labelOf?: (r: DeliveryRecord, idx: number) => string,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const { ganghyungjuId, shindongseokId } = findTeamIds(ctx.leaders);
  if (!ganghyungjuId || !shindongseokId) return out;

  const leaderById = new Map(ctx.leaders.map((l) => [l.id, l] as const));

  let gCount = 0, sCount = 0;
  let gMetro = 0, sMetro = 0;
  let gNote = 0, sNote = 0;
  let gReg = 0, sReg = 0;
  let gCod = 0, sCod = 0;

  rows.forEach((r, i) => {
    const rowLabel = labelOf ? labelOf(r, i) : `행 ${i + 1}`;
    const push = (severity: Severity, code: string, message: string) =>
      out.push({ rowId: r.id, rowLabel, code, message, severity });

    // 이 행이 형주/동석 팀과 관련 있는지 (id 또는 이름/별칭 기준)
    const l1 = r.leader1_id ? leaderById.get(r.leader1_id) : null;
    const l2 = r.leader2_id ? leaderById.get(r.leader2_id) : null;
    const l3 = r.leader3_id ? leaderById.get(r.leader3_id) : null;
    const involvesTeam =
      r.leader1_id === ganghyungjuId || r.leader1_id === shindongseokId ||
      r.leader2_id === ganghyungjuId || r.leader2_id === shindongseokId ||
      r.leader3_id === ganghyungjuId || r.leader3_id === shindongseokId ||
      teamNameMatch(r.leader1_name, l1?.aliases) ||
      teamNameMatch(r.leader2_name, l2?.aliases) ||
      teamNameMatch(r.leader3_name, l3?.aliases);
    if (!involvesTeam) return;

    const shares = allocateRow(
      {
        leader1_id: r.leader1_id,
        leader2_id: r.leader2_id,
        leader3_id: r.leader3_id ?? null,
        split_type: r.split_type,
        two_person: r.two_person ?? false,
        metro_fee: isNumLike(r.metro_fee).n,
        note_amount: isNumLike(r.note_amount).n,
        regional_fee: isNumLike(r.regional_fee).n,
        cod_amount: isNumLike(r.cod_amount).n,
      },
      { ganghyungjuId, shindongseokId },
    );

    const g = shares.find((s) => s.leader_id === ganghyungjuId);
    const s = shares.find((sh) => sh.leader_id === shindongseokId);

    if (!g || !s) {
      push(
        "error",
        "team.parity.missing",
        "강형주/신동석 팀 관련 건이지만 한 명에게만 배분됨 (팀장 ID/이름 등록 확인 필요)",
      );
      return;
    }
    if (!approxEq(g.metro, s.metro) || !approxEq(g.note_amount, s.note_amount) ||
        !approxEq(g.regional, s.regional) || !approxEq(g.cod, s.cod)) {
      push(
        "error",
        "team.parity.amount",
        `강형주와 신동석의 기준 배송비가 다릅니다 (강 ${Math.round(g.metro + g.note_amount + g.regional)} vs 신 ${Math.round(s.metro + s.note_amount + s.regional)})`,
      );
    }
    // 중복 계산 감지: 두 사람 합이 행 총액보다 큼
    const rowTotal = isNumLike(r.metro_fee).n + isNumLike(r.note_amount).n + isNumLike(r.regional_fee).n;
    const teamTotal = g.metro + g.note_amount + g.regional + s.metro + s.note_amount + s.regional;
    if (teamTotal > rowTotal + 0.5) {
      push(
        "error",
        "team.parity.double",
        `강형주+신동석 합산(${Math.round(teamTotal)})이 행 총액(${Math.round(rowTotal)})을 초과 — 중복 계산 의심`,
      );
    }

    gCount += g.count; sCount += s.count;
    gMetro += g.metro; sMetro += s.metro;
    gNote += g.note_amount; sNote += s.note_amount;
    gReg += g.regional; sReg += s.regional;
    gCod += g.cod; sCod += s.cod;
  });

  if (gCount !== sCount) {
    out.push({
      rowId: "__team_parity__",
      code: "team.parity.count",
      severity: "error",
      message: `강형주(${gCount}건)와 신동석(${sCount}건)의 형주/동석 팀 배송건수가 다릅니다`,
    });
  }
  const sums: [string, number, number, string][] = [
    ["수도권배송비", gMetro, sMetro, "metro"],
    ["비고금액", gNote, sNote, "note"],
    ["지방배송비", gReg, sReg, "regional"],
    ["착불", gCod, sCod, "cod"],
  ];
  for (const [label, gv, sv, code] of sums) {
    if (!approxEq(gv, sv)) {
      out.push({
        rowId: "__team_parity__",
        code: `team.parity.sum.${code}`,
        severity: "error",
        message: `${label} 합계 불일치: 강형주 ${Math.round(gv)} vs 신동석 ${Math.round(sv)}`,
      });
    }
  }
  return out;
}