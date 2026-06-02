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
  diff: number;
  hiddenRevisitCount: number;
  commonDeductionTotal: number;
  personalDeductionTotal: number;
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

  const companyDisplayTotal = companyStmts.reduce((s, c) => s + (c.finalClaim || 0), 0);
  const leaderShareTotal = leaderStmts.reduce((s, l) => s + (l.payout || 0), 0);
  const commonDeductionTotal = leaderStmts.reduce(
    (s, l) => s + (l.deductions?.commonTotal ?? 0),
    0,
  );
  const personalDeductionTotal = leaderStmts.reduce(
    (s, l) => s + (l.deductions?.personalTotal ?? 0),
    0,
  );

  const issues: VerifyIssue[] = [];

  // 누락 / 0원 / 중복
  const dupMap = new Map<string, StmtDelivery[]>();
  for (const d of deliveries) {
    const miss: string[] = [];
    if (!norm(d.customer_name)) miss.push("고객명");
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
        customer: norm(d.customer_name),
        company: norm(d.company_name),
      });
    }
    const metro = Number(d.metro_fee || 0);
    const reg = Number(d.regional_fee || 0);
    const cod = Number(d.cod_amount || 0);
    if (metro === 0 && reg === 0 && cod === 0) {
      // 재방문 2차 이상은 정상 케이스이므로 제외
      if (!(d.revisit_group_id && Number(d.revisit_visit_no ?? 1) >= 2)) {
        issues.push({
          severity: "warning",
          code: "ZERO_FEE",
          message: "배송비와 착불이 모두 0원",
          deliveryId: d.id,
          date: d.date,
          customer: norm(d.customer_name),
          company: norm(d.company_name),
        });
      }
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
      for (const d of arr) {
        issues.push({
          severity: "warning",
          code: "DUPLICATE",
          message: `중복 의심 (${arr.length}건) ${key}`,
          deliveryId: d.id,
          date: d.date,
          customer: norm(d.customer_name),
          company: norm(d.company_name),
        });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    deliveryCount: deliveries.length,
    companyDisplayTotal,
    leaderShareTotal,
    diff: companyDisplayTotal - leaderShareTotal,
    hiddenRevisitCount,
    commonDeductionTotal,
    personalDeductionTotal,
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
        r.share.metro_fee, r.share.note_amount, r.share.regional_fee, r.share.cod_amount,
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
  rows.push(["업체 표시 합계", result.companyDisplayTotal]);
  rows.push(["팀장 배분 합계", result.leaderShareTotal]);
  rows.push(["차액", result.diff]);
  rows.push(["숨겨진 재방문 2차+ 건수", result.hiddenRevisitCount]);
  rows.push(["공통공제 합계", result.commonDeductionTotal]);
  rows.push(["개별공제 합계", result.personalDeductionTotal]);
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