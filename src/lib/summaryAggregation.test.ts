import { describe, it, expect } from "vitest";
import {
  inPeriod,
  isCountableLeader,
  resolveSettleId,
  aggregateSummary,
  type SummaryLeader,
  type SummaryCompany,
  type SummaryDelivery,
} from "./summaryAggregation";

const baseLeader = (over: Partial<SummaryLeader> & { id: string; name: string }): SummaryLeader => ({
  active: true, is_rejected: false, is_virtual: false, settle_to_id: null,
  settle_status: "included", aliases: [], deduction_amount: 0, trash_cost: 0,
  ...over,
});

const D = (over: Partial<SummaryDelivery>): SummaryDelivery => ({
  date: "2026-05-10",
  company_id: "C1", company_name: "모던",
  leader1_id: null, leader2_id: null, leader3_id: null,
  split_type: null, two_person: false,
  metro_fee: 0, note_amount: 0, regional_fee: 0, cod_amount: 0,
  ...over,
});

describe("inPeriod", () => {
  it("h1: 1~15일만 포함", () => {
    expect(inPeriod("2026-05-01", "h1")).toBe(true);
    expect(inPeriod("2026-05-15", "h1")).toBe(true);
    expect(inPeriod("2026-05-16", "h1")).toBe(false);
    expect(inPeriod("2026-05-31", "h1")).toBe(false);
  });
  it("h2: 16~말일", () => {
    expect(inPeriod("2026-05-15", "h2")).toBe(false);
    expect(inPeriod("2026-05-16", "h2")).toBe(true);
    expect(inPeriod("2026-05-31", "h2")).toBe(true);
  });
  it("all: 전체", () => {
    expect(inPeriod("2026-05-01", "all")).toBe(true);
    expect(inPeriod("2026-05-31", "all")).toBe(true);
  });
  it("잘못된 날짜는 false", () => {
    expect(inPeriod("", "all")).toBe(false);
  });
});

describe("isCountableLeader", () => {
  it("활성·비거부·비가상·정산포함·최종이면 true", () => {
    expect(isCountableLeader(baseLeader({ id: "L1", name: "A" }))).toBe(true);
  });
  it("비활성/거부/가상/정산제외/settle_to_id 있으면 false", () => {
    expect(isCountableLeader(baseLeader({ id: "L1", name: "A", active: false }))).toBe(false);
    expect(isCountableLeader(baseLeader({ id: "L1", name: "A", is_rejected: true }))).toBe(false);
    expect(isCountableLeader(baseLeader({ id: "L1", name: "A", is_virtual: true }))).toBe(false);
    expect(isCountableLeader(baseLeader({ id: "L1", name: "A", settle_status: "excluded" }))).toBe(false);
    expect(isCountableLeader(baseLeader({ id: "L1", name: "A", settle_to_id: "L2" }))).toBe(false);
  });
});

describe("resolveSettleId", () => {
  it("settle_to_id 체인을 끝까지 따라감", () => {
    const a = baseLeader({ id: "A", name: "오은규", settle_to_id: "B" });
    const b = baseLeader({ id: "B", name: "오동선" });
    const map = new Map([["A", a], ["B", b]]);
    expect(resolveSettleId("A", map)).toBe("B");
    expect(resolveSettleId("B", map)).toBe("B");
  });
  it("순환 참조를 안전하게 처리", () => {
    const a = baseLeader({ id: "A", name: "A", settle_to_id: "B" });
    const b = baseLeader({ id: "B", name: "B", settle_to_id: "A" });
    const map = new Map([["A", a], ["B", b]]);
    expect(["A", "B"]).toContain(resolveSettleId("A", map));
  });
});

describe("aggregateSummary - 기간별 집계", () => {
  const companies: SummaryCompany[] = [{ id: "C1", name: "모던", active: true }];
  const leaders: SummaryLeader[] = [baseLeader({ id: "L1", name: "김기사" })];

  const rows: SummaryDelivery[] = [
    D({ date: "2026-05-05", leader1_id: "L1", metro_fee: 10000 }),
    D({ date: "2026-05-12", leader1_id: "L1", metro_fee: 20000 }),
    D({ date: "2026-05-20", leader1_id: "L1", metro_fee: 30000 }),
    D({ date: "2026-05-28", leader1_id: "L1", metro_fee: 40000 }),
  ];

  it("h1: 1~15일 합계", () => {
    const r = aggregateSummary(rows, companies, leaders, "h1");
    expect(r.validRowCount).toBe(2);
    expect(r.companyTotal).toBe(30000);
    expect(r.leaderFeeTotal).toBe(30000);
    expect(r.diff).toBe(0);
  });
  it("h2: 16~말일 합계", () => {
    const r = aggregateSummary(rows, companies, leaders, "h2");
    expect(r.validRowCount).toBe(2);
    expect(r.companyTotal).toBe(70000);
    expect(r.diff).toBe(0);
  });
  it("all: 월 전체 합계", () => {
    const r = aggregateSummary(rows, companies, leaders, "all");
    expect(r.validRowCount).toBe(4);
    expect(r.companyTotal).toBe(100000);
    expect(r.diff).toBe(0);
  });
});

describe("aggregateSummary - 업체↔팀장 총액 검증", () => {
  it("정상 케이스: 차이 0", () => {
    const companies: SummaryCompany[] = [{ id: "C1", name: "모던", active: true }];
    const leaders = [baseLeader({ id: "L1", name: "A" }), baseLeader({ id: "L2", name: "B" })];
    const rows = [
      D({ leader1_id: "L1", metro_fee: 10000, note_amount: 1000, regional_fee: 2000 }),
      D({ leader1_id: "L2", metro_fee: 5000, regional_fee: 5000 }),
    ];
    const r = aggregateSummary(rows, companies, leaders, "all");
    expect(r.companyTotal).toBe(23000);
    expect(r.leaderFeeTotal).toBe(23000);
    expect(r.diff).toBe(0);
  });

  it("2인배송 50/50: 업체총액 = 팀장총액", () => {
    const companies: SummaryCompany[] = [{ id: "C1", name: "모던", active: true }];
    const leaders = [baseLeader({ id: "L1", name: "A" }), baseLeader({ id: "L2", name: "B" })];
    const rows = [
      D({ leader1_id: "L1", leader2_id: "L2", two_person: true, metro_fee: 10000 }),
    ];
    const r = aggregateSummary(rows, companies, leaders, "all");
    expect(r.companyTotal).toBe(10000);
    expect(r.leaderFeeTotal).toBeCloseTo(10000, 5);
    expect(r.diff).toBeCloseTo(0, 5);
    const a = r.leaders.find((x) => x.id === "L1")!;
    const b = r.leaders.find((x) => x.id === "L2")!;
    expect(a.fee).toBeCloseTo(5000, 5);
    expect(b.fee).toBeCloseTo(5000, 5);
  });

  it("미배정 행은 양쪽 모두에서 제외 → 차이 0", () => {
    const companies: SummaryCompany[] = [{ id: "C1", name: "모던", active: true }];
    const leaders = [baseLeader({ id: "L1", name: "A" })];
    const rows = [
      D({ leader1_id: "L1", metro_fee: 10000 }),
      D({ leader1_id: null, metro_fee: 99999 }), // 팀장 없음
    ];
    const r = aggregateSummary(rows, companies, leaders, "all");
    expect(r.companyTotal).toBe(10000);
    expect(r.leaderFeeTotal).toBe(10000);
    expect(r.diff).toBe(0);
  });

  it("정산제외 팀장만 배정된 행 → 양쪽 모두 제외", () => {
    const companies: SummaryCompany[] = [{ id: "C1", name: "모던", active: true }];
    const leaders = [
      baseLeader({ id: "L1", name: "정상" }),
      baseLeader({ id: "L2", name: "오은규", settle_status: "excluded" }),
    ];
    const rows = [
      D({ leader1_id: "L1", metro_fee: 10000 }),
      D({ leader1_id: "L2", metro_fee: 50000 }),
    ];
    const r = aggregateSummary(rows, companies, leaders, "all");
    expect(r.companyTotal).toBe(10000);
    expect(r.leaderFeeTotal).toBe(10000);
    expect(r.diff).toBe(0);
  });

  it("오은규 → 오동선 합산: 차이 0, 오동선에 집계", () => {
    const companies: SummaryCompany[] = [{ id: "C1", name: "모던", active: true }];
    const leaders = [
      baseLeader({ id: "OD", name: "오동선" }),
      baseLeader({ id: "OE", name: "오은규", settle_to_id: "OD" }),
    ];
    const rows = [D({ leader1_id: "OE", metro_fee: 12000 })];
    const r = aggregateSummary(rows, companies, leaders, "all");
    expect(r.companyTotal).toBe(12000);
    expect(r.leaderFeeTotal).toBe(12000);
    expect(r.diff).toBe(0);
    const od = r.leaders.find((x) => x.id === "OD")!;
    expect(od.fee).toBe(12000);
    expect(od.count).toBe(1);
    expect(r.leaders.find((x) => x.id === "OE")).toBeUndefined();
  });

  it("신동석/강형주 재분배 후에도 업체↔팀장 차이 0", () => {
    const companies: SummaryCompany[] = [{ id: "C1", name: "모던", active: true }];
    const leaders = [
      baseLeader({ id: "SDS", name: "신동석" }),
      baseLeader({ id: "GHJ", name: "강형주" }),
      baseLeader({ id: "X", name: "타팀장" }),
    ];
    const rows = [
      D({ leader1_id: "SDS", metro_fee: 10000 }),
      D({ leader1_id: "X", leader2_id: "SDS", two_person: true, metro_fee: 20000 }),
    ];
    const r = aggregateSummary(rows, companies, leaders, "all", {
      shindongseokId: "SDS", ganghyungjuId: "GHJ",
    });
    expect(r.companyTotal).toBe(30000);
    expect(r.leaderFeeTotal).toBeCloseTo(30000, 5);
    expect(r.diff).toBeCloseTo(0, 5);
    const sds = r.leaders.find((x) => x.id === "SDS")!;
    const ghj = r.leaders.find((x) => x.id === "GHJ")!;
    // 신동석 몫 = 10000 + 10000(2인배송 절반) = 20000 → 재분배 후 각 10000
    expect(sds.fee).toBeCloseTo(10000, 5);
    expect(ghj.fee).toBeCloseTo(10000, 5);
  });

  it("비활성 업체는 표시에서 제외 (행은 유효하면 팀장에는 집계됨 → 차이 발생 가능)", () => {
    const companies: SummaryCompany[] = [
      { id: "C1", name: "모던", active: true },
      { id: "C2", name: "비활성", active: false },
    ];
    const leaders = [baseLeader({ id: "L1", name: "A" })];
    const rows = [
      D({ company_id: "C1", company_name: "모던", leader1_id: "L1", metro_fee: 10000 }),
      D({ company_id: "C2", company_name: "비활성", leader1_id: "L1", metro_fee: 5000 }),
    ];
    const r = aggregateSummary(rows, companies, leaders, "all");
    expect(r.companies.length).toBe(1);
    expect(r.companyTotal).toBe(10000);
    expect(r.leaderFeeTotal).toBe(15000);
    expect(r.diff).toBe(-5000); // 검증: 비활성 업체 매핑된 행이 차이를 만듦
  });
});

describe("aggregateSummary - 비중%", () => {
  it("업체/팀장 비중 합이 100%", () => {
    const companies: SummaryCompany[] = [
      { id: "C1", name: "A", active: true },
      { id: "C2", name: "B", active: true },
    ];
    const leaders = [baseLeader({ id: "L1", name: "X" }), baseLeader({ id: "L2", name: "Y" })];
    const rows = [
      D({ company_id: "C1", company_name: "A", leader1_id: "L1", metro_fee: 30000 }),
      D({ company_id: "C2", company_name: "B", leader1_id: "L2", metro_fee: 70000 }),
    ];
    const r = aggregateSummary(rows, companies, leaders, "all");
    const csum = r.companies.reduce((s, x) => s + x.share, 0);
    const lsum = r.leaders.reduce((s, x) => s + x.share, 0);
    expect(csum).toBeCloseTo(100, 5);
    expect(lsum).toBeCloseTo(100, 5);
  });
});