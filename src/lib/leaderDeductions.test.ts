import { describe, it, expect } from "vitest";
import {
  buildLeaderStatements,
  type StmtDelivery,
  type StmtLeader,
  type DeductionContext,
  type AggregateOptions,
} from "./statementData";

const baseLeader = (over: Partial<StmtLeader>): StmtLeader => ({
  id: over.id!,
  name: over.name!,
  active: true,
  is_rejected: false,
  is_virtual: false,
  settle_to_id: null,
  settle_status: "included",
  aliases: [],
  fee_rate_metro: 0,
  fee_rate_regional: 0,
  issues_invoice: false,
  ...over,
});

const mkDelivery = (over: Partial<StmtDelivery>): StmtDelivery => ({
  id: over.id || "d1",
  date: over.date || "2026-05-05",
  company_id: "c1",
  company_name: "회사1",
  leader1_id: over.leader1_id ?? null,
  leader1_name: null,
  leader2_id: null, leader2_name: null,
  leader3_id: null, leader3_name: null,
  customer_name: null, region: null, region_type: null, item: null, note: null,
  metro_fee: 10000, note_amount: 0, regional_fee: 0, cod_amount: 0,
  split_type: null, two_person: false, paid: false,
  ...over,
});

const opts: AggregateOptions = { oeunkyuSpecial: false };
const TRASH = { id: "cd-trash", label: "쓰레기비용", amount: 50000, active: true };

describe("팀장 공제 회귀 테스트", () => {
  const normal = baseLeader({ id: "L1", name: "홍길동" });
  const hyungju = baseLeader({ id: "L2", name: "강형주" });
  const dongseok = baseLeader({ id: "L3", name: "신동석" });

  const deliveries = [
    mkDelivery({ id: "d1", leader1_id: "L1" }),
    mkDelivery({ id: "d2", leader1_id: "L2" }),
    mkDelivery({ id: "d3", leader1_id: "L3" }),
  ];

  const ctx = (over: Partial<DeductionContext> = {}): DeductionContext => ({
    commonDeductions: [TRASH],
    commonOverrides: [],
    periodDeductions: [],
    periodKey: "2026-05-first",
    commonPeriodKeys: ["2026-05-first"],
    ...over,
  });

  it("일반 팀장은 쓰레기비용(공통공제)이 그대로 적용된다", () => {
    const stmts = buildLeaderStatements(deliveries, [normal, hyungju, dongseok], "h1", opts, ctx());
    const s = stmts.find((x) => x.leader.id === "L1")!;
    expect(s.deductionTotal).toBe(50000);
    expect(s.deductions?.commonLines.map((l) => l.label)).toEqual(["쓰레기비용"]);
  });

  it("강형주/신동석은 쓰레기비용이 0원으로 자동 제외된다", () => {
    const stmts = buildLeaderStatements(deliveries, [normal, hyungju, dongseok], "h1", opts, ctx());
    const sh = stmts.find((x) => x.leader.id === "L2")!;
    const sd = stmts.find((x) => x.leader.id === "L3")!;
    expect(sh.deductionTotal).toBe(0);
    expect(sd.deductionTotal).toBe(0);
    expect(sh.deductions?.commonLines.length).toBe(0);
  });

  it("월 전체(all)는 보름 키 2개로 쓰레기비용이 2회 차감된다", () => {
    const stmts = buildLeaderStatements(deliveries, [normal], "all", opts, ctx({
      commonPeriodKeys: ["2026-05-first", "2026-05-second"],
      periodKey: "all",
    }));
    expect(stmts[0].deductionTotal).toBe(100000);
    expect(stmts[0].deductions?.commonLines.length).toBe(2);
  });

  it("팀장별 오버라이드 금액이 우선 적용된다", () => {
    const stmts = buildLeaderStatements(deliveries, [normal], "h1", opts, ctx({
      commonOverrides: [{
        leader_id: "L1", common_deduction_id: "cd-trash",
        period_key: "2026-05-first", amount: 12345,
      }],
    }));
    expect(stmts[0].deductionTotal).toBe(12345);
  });

  it("오버라이드로 강형주의 쓰레기비용을 명시하면 그 금액이 적용된다", () => {
    const stmts = buildLeaderStatements(deliveries, [hyungju], "h1", opts, ctx({
      commonOverrides: [{
        leader_id: "L2", common_deduction_id: "cd-trash",
        period_key: "2026-05-first", amount: 7000,
      }],
    }));
    expect(stmts[0].deductionTotal).toBe(7000);
  });

  it("중복 라벨의 공통공제는 1회만 적용된다(중복 제거)", () => {
    const stmts = buildLeaderStatements(deliveries, [normal], "h1", opts, ctx({
      commonDeductions: [TRASH, { ...TRASH, id: "cd-trash-dup", amount: 99999 }],
    }));
    expect(stmts[0].deductionTotal).toBe(50000);
  });

  it("개별공제(personal)는 공통공제와 합산된다", () => {
    const stmts = buildLeaderStatements(deliveries, [normal], "h1", opts, ctx({
      periodDeductions: [{
        leader_id: "L1", period_key: "2026-05-first",
        label: "보험", amount: 3000,
      }],
    }));
    expect(stmts[0].deductions?.personalTotal).toBe(3000);
    expect(stmts[0].deductionTotal).toBe(53000);
  });

  it("비활성 공통공제는 제외된다", () => {
    const stmts = buildLeaderStatements(deliveries, [normal], "h1", opts, ctx({
      commonDeductions: [{ ...TRASH, active: false }],
    }));
    expect(stmts[0].deductionTotal).toBe(0);
  });

  it("실지급액 = 계산후 - 착불 - 공제 (회귀 보장)", () => {
    const stmts = buildLeaderStatements(deliveries, [normal], "h1", opts, ctx());
    const s = stmts.find((x) => x.leader.id === "L1")!;
    expect(s.payout).toBe(s.afterFee - s.codSum - s.deductionTotal);
  });
});
