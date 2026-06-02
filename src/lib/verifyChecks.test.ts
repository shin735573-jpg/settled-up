import { describe, expect, it } from "vitest";
import {
  companiesCsv,
  runVerify,
  verifyResultCsv,
} from "./verifyChecks";
import type {
  DeductionContext,
  StmtCommonDeduction,
  StmtCompany,
  StmtDelivery,
  StmtLeader,
} from "./statementData";

const company: StmtCompany = {
  id: "c1", name: "마조드까사", active: true, issues_invoice: true,
  vat_included: false, fee_rate_metro: 0, fee_rate_regional: 0,
  settlement_cycle: "biweekly", account_number: null, has_cod: true,
  rejected_leader_id: null, rejected_leader_id_2: null, rejected_leader_id_3: null,
};

const mkLeader = (id: string, name: string): StmtLeader => ({
  id, name, active: true, settle_status: "included", settle_to_id: null,
  aliases: [], is_rejected: false, is_virtual: false,
} as unknown as StmtLeader);

const mkRow = (over: Partial<StmtDelivery>): StmtDelivery => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-05-22",
  company_id: "c1", company_name: "마조드까사",
  leader1_id: null, leader1_name: null,
  leader2_id: null, leader2_name: null,
  leader3_id: null, leader3_name: null,
  customer_name: "송인호", region: "서울", region_type: "metro",
  item: "1800식탁", note: null,
  metro_fee: 0, note_amount: 0, regional_fee: 0, cod_amount: 0,
  split_type: null, two_person: false, paid: false,
  ...over,
});

const emptyCtx: DeductionContext = {
  commonDeductions: [], commonOverrides: [], periodDeductions: [],
  periodKey: "2026-05-second", commonPeriodKeys: ["2026-05-second"],
};

describe("verifyChecks", () => {
  it("재방문 2차 이상은 업체 CSV에 표시되지 않고 hiddenRevisitCount로 보고된다", () => {
    const leaders = [mkLeader("L1", "맹광식"), mkLeader("L2", "오은규")];
    const deliveries = [
      mkRow({
        id: "r1", date: "2026-05-22", leader1_id: "L1", leader1_name: "맹광식",
        metro_fee: 130000, revisit_group_id: "G1", revisit_visit_no: 1,
      }),
      mkRow({
        id: "r2", date: "2026-05-22", leader1_id: "L2", leader1_name: "오은규",
        metro_fee: 0, revisit_group_id: "G1", revisit_visit_no: 2,
      }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders, period: "h2",
      deductionCtx: emptyCtx,
    });
    expect(r.hiddenRevisitCount).toBe(1);
    // 업체 표시 합계는 1차 130,000만 반영, 2차 65,000은 제외
    expect(r.companyDisplayTotal).toBe(130000);
    const csv = companiesCsv(r.companyStmts);
    // 1차만 표시
    const dataLines = csv.split(/\r\n/).filter((l) => l.includes("송인호"));
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain("130000");
  });

  it("재방문 2차 65,000원은 업체 표시 합계에서 제외되지만 deliveries에는 유지되어 팀장 검산에 사용된다", () => {
    const leaders = [mkLeader("L1", "맹광식"), mkLeader("L2", "오은규")];
    const deliveries = [
      mkRow({
        id: "r1", date: "2026-05-22", leader1_id: "L1", leader1_name: "맹광식",
        metro_fee: 130000, revisit_group_id: "G1", revisit_visit_no: 1,
      }),
      mkRow({
        id: "r2", date: "2026-05-22", leader1_id: "L2", leader1_name: "오은규",
        metro_fee: 65000, revisit_group_id: "G1", revisit_visit_no: 2,
      }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders, period: "h2",
      deductionCtx: emptyCtx,
    });
    expect(r.companyDisplayTotal).toBe(130000);
    expect(r.hiddenRevisitCount).toBe(1);
    expect(r.deliveryCount).toBe(2);
  });

  it("업체 표시 합계와 팀장 실지급 합계의 단순 차액을 오류로 만들지 않는다", () => {
    const leaders = [mkLeader("L1", "맹광식")];
    const deliveries = [
      mkRow({ date: "2026-05-05", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 100000 }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders, period: "h1",
      deductionCtx: emptyCtx,
    });
    expect(r.errorCount).toBe(0);
    // 두 값은 서로 다른 기준이므로 별도 노출되어야 함
    expect(typeof r.companyDisplayTotal).toBe("number");
    expect(typeof r.leaderShareTotal).toBe("number");
  });

  it("2026-05 월전체 fixtures: 업체 표시 합계 26,660,000 / 숨겨진 재방문 2차+ 1건", () => {
    const leaders = [mkLeader("L1", "맹광식"), mkLeader("L2", "오은규")];
    // 일반 배송 26,595,000원 + 1차 재방문 65,000원 = 업체 표시 26,660,000원
    const deliveries: StmtDelivery[] = [
      mkRow({ date: "2026-05-03", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 10000000 }),
      mkRow({ date: "2026-05-10", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 8000000, regional_fee: 500000, note_amount: 95000 }),
      mkRow({ date: "2026-05-20", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 8000000 }),
      mkRow({
        date: "2026-05-22", leader1_id: "L1", leader1_name: "맹광식",
        metro_fee: 65000, revisit_group_id: "G1", revisit_visit_no: 1,
      }),
      mkRow({
        date: "2026-05-22", leader1_id: "L2", leader1_name: "오은규",
        metro_fee: 65000, revisit_group_id: "G1", revisit_visit_no: 2,
      }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders, period: "all",
      deductionCtx: { ...emptyCtx, periodKey: "all", commonPeriodKeys: ["2026-05-first", "2026-05-second"] },
    });
    expect(r.companyDisplayTotal).toBe(26660000);
    expect(r.hiddenRevisitCount).toBe(1);
  });

  it("공통공제 50,000원: h1=50000, h2=50000, all=100000", () => {
    const leaders = [mkLeader("L1", "맹광식")];
    const common: StmtCommonDeduction[] = [
      { id: "cd1", label: "쓰레기비용", amount: 50000, active: true },
    ];
    const deliveries = [
      mkRow({ date: "2026-05-05", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 100000 }),
      mkRow({ date: "2026-05-20", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 100000 }),
    ];
    const ctx = (period: "h1" | "h2" | "all"): DeductionContext => ({
      commonDeductions: common, commonOverrides: [], periodDeductions: [],
      periodKey: period === "all" ? "all" : `2026-05-${period === "h1" ? "first" : "second"}`,
      commonPeriodKeys: period === "all"
        ? ["2026-05-first", "2026-05-second"]
        : [`2026-05-${period === "h1" ? "first" : "second"}`],
    });
    const h1 = runVerify({ deliveries, companies: [company], leaders, period: "h1", deductionCtx: ctx("h1") });
    const h2 = runVerify({ deliveries, companies: [company], leaders, period: "h2", deductionCtx: ctx("h2") });
    // 월전체는 monthly 사이클이 아니라서 업체 게이트가 닫히지만 팀장공제는 동작
    const all = runVerify({ deliveries, companies: [company], leaders, period: "all", deductionCtx: ctx("all") });
    expect(h1.commonDeductionTotal).toBe(50000);
    expect(h2.commonDeductionTotal).toBe(50000);
    expect(all.commonDeductionTotal).toBe(100000);
  });

  it("팀장 배분은 재방문 2차+ 행을 그대로 반영한다 (업체 숨김과 무관)", () => {
    const leaders = [mkLeader("L1", "맹광식"), mkLeader("L2", "오은규")];
    const deliveries = [
      mkRow({
        id: "r1", date: "2026-05-22", leader1_id: "L1", leader1_name: "맹광식",
        metro_fee: 130000, revisit_group_id: "G1", revisit_visit_no: 1,
      }),
      mkRow({
        id: "r2", date: "2026-05-22", leader1_id: "L2", leader1_name: "오은규",
        metro_fee: 0, revisit_group_id: "G1", revisit_visit_no: 2,
      }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders, period: "h2",
      deductionCtx: emptyCtx,
    });
    // 두 팀장 모두 정산 대상
    const names = r.leaderStmts.map((l) => l.leader.name).sort();
    expect(names).toEqual(["맹광식", "오은규"]);
  });

  it("검산결과 CSV는 BOM과 요약 헤더를 포함한다", () => {
    const r = runVerify({
      deliveries: [], companies: [], leaders: [], period: "h1",
      deductionCtx: emptyCtx,
    });
    const csv = verifyResultCsv(r);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("배송건수");
    expect(csv).toContain("[상세 이슈]");
  });

  it("업체 배송총합과 팀장 배송총합이 같으면 총합 차이 0원", () => {
    const leaders = [mkLeader("L1", "맹광식")];
    const deliveries = [
      mkRow({ date: "2026-05-05", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 100000, regional_fee: 20000, note_amount: 5000 }),
      mkRow({ date: "2026-05-12", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 80000 }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders, period: "h1", deductionCtx: emptyCtx,
    });
    expect(r.companyDeliveryTotal).toBe(205000);
    expect(r.leaderDeliveryTotal).toBe(205000);
    expect(r.totalsDiff).toBe(0);
    expect(r.issues.find((i) => i.code === "TOTALS_MISMATCH")).toBeUndefined();
  });

  it("재방문 2차+ 1건은 업체표시합계에서 숨겨져도 원총합 검산에는 포함되어 차이 0원", () => {
    const leaders = [mkLeader("L1", "맹광식"), mkLeader("L2", "오은규")];
    const deliveries = [
      mkRow({
        id: "r1", date: "2026-05-22", leader1_id: "L1", leader1_name: "맹광식",
        metro_fee: 130000, revisit_group_id: "G1", revisit_visit_no: 1,
      }),
      mkRow({
        id: "r2", date: "2026-05-22", leader1_id: "L2", leader1_name: "오은규",
        metro_fee: 65000, revisit_group_id: "G1", revisit_visit_no: 2,
      }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders, period: "h2", deductionCtx: emptyCtx,
    });
    expect(r.totalsDiff).toBe(0);
    expect(r.companyDisplayTotal).toBe(130000);
    expect(r.companyDeliveryTotal).toBe(195000);
    expect(r.leaderDeliveryTotal).toBe(195000);
    // 업체 CSV에서는 2차 숨김 유지
    expect(r.hiddenRevisitCount).toBe(1);
  });

  it("settle_to_id가 있는 하위 팀장 배송도 상위 팀장 귀속 원총합에 포함된다", () => {
    const parent = mkLeader("P1", "상위팀장");
    const child = { ...mkLeader("C1", "하위팀장"), settle_to_id: "P1" } as StmtLeader;
    const deliveries = [
      mkRow({ date: "2026-05-20", leader1_id: "C1", leader1_name: "하위팀장", metro_fee: 350000 }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders: [parent, child], period: "h2", deductionCtx: emptyCtx,
    });
    expect(r.companyDeliveryTotal).toBe(350000);
    expect(r.leaderDeliveryTotal).toBe(350000);
    expect(r.totalsDiff).toBe(0);
    expect(r.issues.find((i) => i.code === "TOTALS_MISMATCH")).toBeUndefined();
  });

  it("수수료/착불/공제/실지급은 배송총합 비교에 섞이지 않는다", () => {
    const leaders = [mkLeader("L1", "맹광식")];
    const deliveries = [
      mkRow({ date: "2026-05-05", leader1_id: "L1", leader1_name: "맹광식", metro_fee: 100000, cod_amount: 500000 }),
    ];
    const r = runVerify({
      deliveries, companies: [company], leaders, period: "h1", deductionCtx: emptyCtx,
    });
    // 착불 500,000은 배송총합에 포함되지 않음
    expect(r.companyDeliveryTotal).toBe(100000);
    expect(r.leaderDeliveryTotal).toBe(100000);
    expect(r.totalsDiff).toBe(0);
  });
});