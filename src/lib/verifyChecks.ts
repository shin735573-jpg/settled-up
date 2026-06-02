// 정산 검산/백업 전용 헬퍼.
// 기존 정산 계산 로직(statementData.ts)을 읽기 전용으로 호출만 한다. 절대 수정 금지.

import {
  buildCompanyStatements,
  buildLeaderStatements,
  detectSpecialLeaderIds,
  type CompanyStmtData,
  type DeductionContext,
  type LeaderStmtData,
  type PeriodKey,
  type StmtCompany,
  type StmtDelivery,
  type StmtLeader,
} from "./statementData";
import { allocateRow } from "./splitAllocation";
import { isCountableLeader, resolveSettleId, type SummaryLeader } from "./summaryAggregation";

export type VerifyIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  deliveryId?: string;
  date?: string;
  customer?: string;
  company?: string;
};

export type VerifyResult = {
  deliveryCount: number;
  companyDisplayTotal: number;
  leaderShareTotal: number;
  companyClaimTotal: number;
  leaderPayoutTotal: number;
  companyDeliveryTotal: number;
  leaderDeliveryTotal: number;
  totalsDiff: number;
  hiddenRevisitCount: number;
  commonDeductionTotal: number;
  personalDeductionTotal: number;
  totalDeductionTotal: number;
  codTotal: number;
  leaderPayoutBeforeVat: number;
  vatTotal: number;
  errorCount: number;
  warningCount: number;
  issues: VerifyIssue[];
  companyStmts: CompanyStmtData[];
  leaderStmts: LeaderStmtData[];
};

export type VerifyInput = {
  deliveries: StmtDelivery[];
  companies: StmtCompany[];
  leaders: StmtLeader[];
  period: PeriodKey;
  deductionCtx: DeductionContext;
  oeunkyuSpecial?: boolean;
};

const norm = (s: unknown) => String(s ?? "").trim();
export const displayCustomerName = (s: unknown) => {
  const v = String(s ?? "").trim();
  return v.length ? v : "고객명 없음";
};
const deliveryBaseAmount = (d: StmtDelivery) =>
  Number(d.metro_fee || 0) + Number(d.regional_fee || 0) + Number(d.note_amount || 0);

function computeLeaderDeliveryOriginalTotal(
  deliveries: StmtDelivery[],
  leaders: StmtLeader[],
  special: ReturnType<typeof detectSpecialLeaderIds>,
  oeunkyuSpecial: boolean,
) {
  const byId = new Map(leaders.map((l) => [l.id, l]));
  const virtualIds = new Set(leaders.filter((l) => l.is_virtual).map((l) => l.id));

  return deliveries.reduce((sum, d) => {
    const shares = allocateRow(
      {
        leader1_id: d.leader1_id,
        leader2_id: d.leader2_id,
        leader3_id: d.leader3_id,
        split_type: d.split_type,
        two_person: d.two_person ?? false,
        metro_fee: Number(d.metro_fee || 0),
        note_amount: Number(d.note_amount || 0),
        regional_fee: Number(d.regional_fee || 0),
        cod_amount: Number(d.cod_amount || 0),
        virtual_leader_id: d.virtual_leader_id ?? null,
      },
      {
        shindongseokId: special.shindongseokId,
        ganghyungjuId: special.ganghyungjuId,
        oeunkyuId: oeunkyuSpecial ? special.oeunkyuId : null,
        odongseonId: oeunkyuSpecial ? special.odongseonId : null,
        kimyongikId: special.kimyongikId,
        virtualIds,
      },
    );

    const rowTotal = shares.reduce((rowSum, s) => {
      const target = resolveSettleId(s.leader_id, byId as Map<string, SummaryLeader>);
      if (!isCountableLeader(byId.get(target))) return rowSum;
      return rowSum + Number(s.metro || 0) + Number(s.regional || 0) + Number(s.note_amount || 0);
    }, 0);
    return sum + rowTotal;
  }, 0);
}

export function runVerify(input: VerifyInput): VerifyResult {
  const { deliveries, companies, leaders, period, deductionCtx, oeunkyuSpecial = true } = input;

  const special = detectSpecialLeaderIds(leaders);
  // 기존 계산 로직을 그대로 호출 (수정 금지)
  const companyStmts = buildCompanyStatements(deliveries, companies, leaders, period);
  const leaderStmts = buildLeaderStatements(
    deliveries,
    leaders,
    period,
    { ...special, oeunkyuSpecial },
    deductionCtx,
  );

  // 업체 표시에서 숨겨진 재방문 2차 이상 건수 (deliveries 원본 기준)
  const hiddenRevisitCount = deliveries.filter(
    (d) => d.revisit_group_id && Number(d.revisit_visit_no ?? 1) >= 2,
  ).length;

  // 업체 표시 합계 = 기존 업체정산과 동일 기준:
  //   metro_fee + regional_fee + note_amount, 재방문 2차+ 제외, 착불/수수료/공제 미포함
  const companyDisplayTotal = deliveries.reduce((s, d) => {
    if (d.revisit_group_id && Number(d.revisit_visit_no ?? 1) >= 2) return s;
    return s + deliveryBaseAmount(d);
  }, 0);
  // 검산용 업체 배송총합 = 모든 deliveries(재방문 2차+ 포함)의 배송비 원금 합계
  // 팀장 배송총합과 동일한 대상 배송건을 기준으로 한다. 착불/수수료/공제/VAT는 제외.
  const companyDeliveryTotal = deliveries.reduce((s, d) => s + deliveryBaseAmount(d), 0);
  // 팀장 배송총합 = 검산 전용 원본 배송행 기준 배분 합계.
  // 기존 팀장 정산서의 수수료/공제/재방문 차감 결과가 아니라, 각 원 배송금액을 배분 후 settle_to_id 상위 팀장으로 귀속한다.
  const leaderDeliveryTotal = computeLeaderDeliveryOriginalTotal(deliveries, leaders, special, oeunkyuSpecial);
  const totalsDiff = companyDeliveryTotal - leaderDeliveryTotal;
  const companyClaimTotal = companyStmts.reduce((s, c) => s + (c.finalClaim || 0), 0);
  const leaderShareTotal = leaderStmts.reduce((s, l) => s + (l.payout || 0), 0);
  const leaderPayoutTotal = leaderStmts.reduce((s, l) => s + (l.payoutWithVat || l.payout || 0), 0);
  const commonDeductionTotal = leaderStmts.reduce(
    (s, l) => s + (l.deductions?.commonTotal ?? 0),
    0,
  );
  const personalDeductionTotal = leaderStmts.reduce(
    (s, l) => s + (l.deductions?.personalTotal ?? 0),
    0,
  );
  const totalDeductionTotal = commonDeductionTotal + personalDeductionTotal;
  const codTotal = leaderStmts.reduce((s, l) => s + (l.codSum || 0), 0);
  const leaderPayoutBeforeVat = leaderStmts.reduce((s, l) => s + (l.payout || 0), 0);
  const vatTotal = leaderStmts.reduce((s, l) => s + (l.vat || 0), 0);

  const issues: VerifyIssue[] = [];

  // 업체 배송총합 vs 팀장 배송총합 (반올림 1원 이내 허용)
  if (Math.abs(totalsDiff) > 1) {
    issues.push({
      severity: "error",
      code: "TOTALS_MISMATCH",
      message: `업체 배송총합(${companyDeliveryTotal}) ≠ 팀장 배송총합(${leaderDeliveryTotal}), 차이 ${totalsDiff}`,
    });
  }

  // 누락 / 0원 / 중복
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const dupMap = new Map<string, StmtDelivery[]>();
  for (const d of deliveries) {
    const miss: string[] = [];
    // 고객명 누락은 "고객명 없음"으로 자동 보정 — 경고하지 않음
    if (!norm(d.item)) miss.push("품목");
    if (!d.company_id && !norm(d.company_name)) miss.push("업체");
    if (!d.leader1_id && !norm(d.leader1_name)) miss.push("팀장");
    if (miss.length) {
      issues.push({
        severity: "warning",
        code: "MISSING",
        message: `${miss.join("/")} 누락`,
        deliveryId: d.id,
        date: d.date,
        customer: displayCustomerName(d.customer_name),
        company: norm(d.company_name),
      });
    }
    // 배송비 0원은 "배송비 없음" 정상 케이스 — ZERO_FEE 경고를 만들지 않음
    // has_cod=false 업체에서 착불 입력이 들어오면 주의
    const cod = Number(d.cod_amount || 0);
    const comp = d.company_id ? companyById.get(d.company_id) : undefined;
    if (comp && comp.has_cod === false && cod > 0) {
      issues.push({
        severity: "warning",
        code: "COD_NOT_EXPECTED",
        message: `착불 미사용 업체에 착불 ${cod}원 입력 확인`,
        deliveryId: d.id,
        date: d.date,
        customer: displayCustomerName(d.customer_name),
        company: norm(d.company_name),
      });
    }
    // 추가 금액 검수 (사용자 요청 #2)
    const feeSum = Number(d.metro_fee || 0) + Number(d.regional_fee || 0) + Number(d.note_amount || 0);
    if (feeSum <= 0 && cod <= 0) {
      issues.push({
        severity: "warning", code: "ZERO_ALL",
        message: "배송비와 착불이 모두 0원",
        deliveryId: d.id, date: d.date,
        customer: displayCustomerName(d.customer_name), company: norm(d.company_name),
      });
    }
    if (feeSum <= 0 && cod > 0) {
      issues.push({
        severity: "warning", code: "COD_ONLY",
        message: "배송비 없이 착불만 입력",
        deliveryId: d.id, date: d.date,
        customer: displayCustomerName(d.customer_name), company: norm(d.company_name),
      });
    }
    if (feeSum > 0 && cod > feeSum) {
      issues.push({
        severity: "warning", code: "COD_GT_FEE",
        message: `착불(${cod})이 배송비합계(${feeSum})보다 큼`,
        deliveryId: d.id, date: d.date,
        customer: displayCustomerName(d.customer_name), company: norm(d.company_name),
      });
    }
    if (d.paid && cod > 0) {
      issues.push({
        severity: "warning", code: "PAID_BUT_COD",
        message: `결제완료인데 착불 ${cod}원 남아 있음`,
        deliveryId: d.id, date: d.date,
        customer: displayCustomerName(d.customer_name), company: norm(d.company_name),
      });
    }
    const dupKey = [
      d.date,
      d.company_id || norm(d.company_name),
      norm(d.customer_name),
      norm(d.item),
    ].join("|");
    if (norm(d.customer_name) && norm(d.item)) {
      const arr = dupMap.get(dupKey) ?? [];
      arr.push(d);
      dupMap.set(dupKey, arr);
    }
  }
  for (const [key, arr] of dupMap) {
    if (arr.length > 1) {
      // 재방문 그룹으로 묶인 경우는 정상 — 제외
      const allSameGroup =
        !!arr[0].revisit_group_id &&
        arr.every((x) => x.revisit_group_id === arr[0].revisit_group_id);
      if (allSameGroup) continue;
      // 같은 묶음은 1건만 표시 (사용자 요청 #8)
      const head = arr[0];
      issues.push({
        severity: "warning",
        code: "DUPLICATE",
        message: `중복 의심 (${arr.length}건) ${key}`,
        deliveryId: head.id,
        date: head.date,
        customer: displayCustomerName(head.customer_name),
        company: norm(head.company_name),
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    deliveryCount: deliveries.length,
    companyDisplayTotal,
    leaderShareTotal,
    companyClaimTotal,
    leaderPayoutTotal,
    companyDeliveryTotal,
    leaderDeliveryTotal,
    totalsDiff,
    hiddenRevisitCount,
    commonDeductionTotal,
    personalDeductionTotal,
    totalDeductionTotal,
    codTotal,
    leaderPayoutBeforeVat,
    vatTotal,
    errorCount,
    warningCount,
    issues,
    companyStmts,
    leaderStmts,
  };
}

// ─── CSV ────────────────────────────────────────────────
const BOM = "\uFEFF";
const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return BOM + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

/** 업체별 정산 CSV — revisit_visit_no>=2 행은 buildCompanyStatements가 이미 1차로 합산해 둔 결과를 그대로 사용 */
export function companiesCsv(companyStmts: CompanyStmtData[]): string {
  const rows: (string | number)[][] = [];
  rows.push([
    "업체", "날짜", "고객명", "배송지", "품목", "팀장1", "팀장2", "팀장3",
    "수도권배송비", "비고금액", "지방배송비", "착불", "비고",
  ]);
  for (const cs of companyStmts) {
    for (const r of cs.rows) {
      rows.push([
        cs.company.name, r.date, r.customer_name ?? "", r.region ?? "", r.item ?? "",
        r.display_leader1, r.display_leader2, r.display_leader3,
        r.metro_fee, r.note_amount, r.regional_fee, r.cod_amount, r.note ?? "",
      ]);
    }
    rows.push([
      cs.company.name, "[합계]", "", "", "", "", "", "",
      cs.feeTotal, "", "", cs.codTotal, "",
    ]);
    rows.push([
      cs.company.name, "[실청구]", "", "", "", "", "", "",
      cs.realClaim, "", "", "", "",
    ]);
    rows.push([
      cs.company.name, "[최종청구(VAT포함)]", "", "", "", "", "", "",
      cs.claimWithVat, "", "", "", "",
    ]);
  }
  return toCsv(rows);
}

/** 팀장별 정산 CSV — 기존 팀장정산 계산 결과를 그대로 직렬화 */
export function leadersCsv(leaderStmts: LeaderStmtData[]): string {
  const rows: (string | number)[][] = [];
  rows.push([
    "팀장", "날짜", "업체", "고객명", "품목",
    "수도권배송비", "비고금액", "지방배송비", "착불",
    "건별수수료", "건별계산후", "건별실지급",
  ]);
  for (const ls of leaderStmts) {
    for (const r of ls.rows) {
      rows.push([
        ls.leader.name, r.delivery.date, r.delivery.company_name ?? "",
        r.delivery.customer_name ?? "", r.delivery.item ?? "",
        r.share.metro, r.share.note_amount, r.share.regional, r.share.cod,
        r.unitFee, r.unitAfterFee, r.unitPayout,
      ]);
    }
    rows.push([
      ls.leader.name, "[합계]", "", "", "",
      ls.metroSum, ls.noteSum, ls.regionalSum, ls.codSum,
      ls.feeTotal, ls.afterFee, ls.payout,
    ]);
    rows.push([
      ls.leader.name, "[공제합계]", "", "", "", "", "", "", "",
      "", ls.deductionTotal, "",
    ]);
    rows.push([
      ls.leader.name, "[실지급(VAT포함)]", "", "", "", "", "", "", "",
      "", "", ls.payoutWithVat,
    ]);
  }
  return toCsv(rows);
}

/** 검산 결과 CSV — 전체 issues 포함 */
export function verifyResultCsv(result: VerifyResult): string {
  const rows: (string | number)[][] = [];
  rows.push(["[요약]"]);
  rows.push(["항목", "값"]);
  rows.push(["배송건수", result.deliveryCount]);
  rows.push(["업체 배송총합", result.companyDeliveryTotal]);
  rows.push(["팀장 배송총합", result.leaderDeliveryTotal]);
  rows.push(["총합 차이", result.totalsDiff]);
  rows.push(["업체 표시 합계", result.companyDisplayTotal]);
  rows.push(["업체 청구 합계(VAT포함)", result.companyClaimTotal]);
  rows.push(["착불합계", result.codTotal]);
  rows.push(["팀장 정산금액(부가세 전)", result.leaderPayoutBeforeVat]);
  rows.push(["부가세", result.vatTotal]);
  rows.push(["팀장 최종지급액(부가세 포함)", result.leaderPayoutTotal]);
  rows.push(["숨겨진 재방문 2차+ 건수", result.hiddenRevisitCount]);
  rows.push(["회사공제 합계", result.commonDeductionTotal]);
  rows.push(["개인공제 합계", result.personalDeductionTotal]);
  rows.push(["총공제 합계", result.totalDeductionTotal]);
  rows.push(["오류 건수", result.errorCount]);
  rows.push(["주의 건수", result.warningCount]);
  rows.push([]);
  rows.push(["[상세 이슈]"]);
  rows.push(["심각도", "코드", "메시지", "날짜", "업체", "고객명", "배송기록ID"]);
  for (const i of result.issues) {
    rows.push([
      i.severity, i.code, i.message,
      i.date ?? "", i.company ?? "", i.customer ?? "", i.deliveryId ?? "",
    ]);
  }
  return toCsv(rows);
}

/** 전체 원본 백업 JSON */
export function backupJson(input: VerifyInput & { month: string }): string {
  const payload = {
    schema: 1,
    exportedAt: new Date().toISOString(),
    month: input.month,
    period: input.period,
    companies: input.companies,
    leaders: input.leaders,
    deliveries: input.deliveries,
    commonDeductions: input.deductionCtx.commonDeductions,
    commonOverrides: input.deductionCtx.commonOverrides,
    periodDeductions: input.deductionCtx.periodDeductions,
  };
  return JSON.stringify(payload, null, 2);
}

/** 브라우저에서 다운로드 트리거 */
export function downloadText(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}