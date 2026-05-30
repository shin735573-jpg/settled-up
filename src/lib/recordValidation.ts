// 배송 기록 종합 오류 검사 엔진 (순수 함수)
// React/Supabase 의존성 없음 — 테스트 가능

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
  is_missing?: boolean;
};

export type CompanyRef = { id: string; name: string };
export type LeaderRef = {
  id: string;
  name: string;
  is_rejected?: boolean;
  is_virtual?: boolean;
  active?: boolean;
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
  }

  // 10. 거부팀장 검사
  const rejectedList = ctx.rejectedLeadersOfCompany?.(r.company_id) || [];
  const rejectedSet = new Set(rejectedList);
  [l1, l2].forEach((lx, i) => {
    if (!lx) return;
    if (lx.is_rejected || rejectedSet.has(lx.id)) {
      push("warning", "leader.rejected",
        `거부팀장 배정 (${lx.name}) → 가상기사 적용 안내`, `팀장${i + 1}`);
    }
  });

  // 11. 휴무일
  if (r.date) {
    const hqOff = ctx.holidays.find((h) => h.scope === "hq" && h.date === r.date);
    if (hqOff) push("error", "holiday.hq", `본사 휴무일 (${r.date})`, "날짜");
    [l1, l2].forEach((lx, i) => {
      if (!lx) return;
      const off = ctx.holidays.find(
        (h) => h.scope === "leader" && h.date === r.date && h.team_leader_id === lx.id);
      if (off) push("error", "holiday.leader", `${lx.name} 휴무일`, `팀장${i + 1}`);
    });
  }

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