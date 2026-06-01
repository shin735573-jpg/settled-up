import { describe, it, expect } from "vitest";
import {
  buildCompanyStatements,
  isSpecialOneTimeItem,
  type StmtDelivery,
  type StmtCompany,
  type StmtLeader,
} from "./statementData";

const company: StmtCompany = {
  id: "c1",
  name: "테스트업체",
  active: true,
  issues_invoice: true,
  vat_included: false,
  fee_rate_metro: 0,
  fee_rate_regional: 0,
  settlement_cycle: "biweekly",
  account_number: null,
  has_cod: true,
  rejected_leader_id: null,
  rejected_leader_id_2: null,
  rejected_leader_id_3: null,
};

const mkLeader = (id: string, name: string): StmtLeader => ({
  id, name, active: true, settle_status: "included", settle_to_id: null,
  aliases: [], is_rejected: false, is_virtual: false,
} as unknown as StmtLeader);

const mkRow = (over: Partial<StmtDelivery>): StmtDelivery => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-06-05",
  company_id: "c1",
  company_name: "테스트업체",
  leader1_id: null, leader1_name: null,
  leader2_id: null, leader2_name: null,
  leader3_id: null, leader3_name: null,
  customer_name: "고객", region: "서울", region_type: "metro",
  item: "일반", note: null,
  metro_fee: 0, note_amount: 0, regional_fee: 0, cod_amount: 0,
  split_type: null, two_person: false, paid: false,
  ...over,
});

describe("행사철수 특수일 처리", () => {
  it("isSpecialOneTimeItem", () => {
    expect(isSpecialOneTimeItem("행사철수")).toBe(true);
    expect(isSpecialOneTimeItem("  행사철수 ")).toBe(true);
    expect(isSpecialOneTimeItem("일반")).toBe(false);
    expect(isSpecialOneTimeItem(null)).toBe(false);
  });

  it("같은 날짜·업체 행사철수 3행은 업체 청구에 1행으로 합산", () => {
    const leaders = [mkLeader("L1", "A팀장"), mkLeader("L2", "B팀장"), mkLeader("L3", "C팀장")];
    const deliveries: StmtDelivery[] = [
      mkRow({ item: "행사철수", leader1_id: "L1", leader1_name: "A팀장", note_amount: 10000 }),
      mkRow({ item: "행사철수", leader1_id: "L2", leader1_name: "B팀장", note_amount: 15000 }),
      mkRow({ item: "행사철수", leader1_id: "L3", leader1_name: "C팀장", note_amount: 20000 }),
      mkRow({ item: "일반", leader1_id: "L1", leader1_name: "A팀장", metro_fee: 5000 }),
    ];
    const [stmt] = buildCompanyStatements(deliveries, [company], leaders, "h1");
    const special = stmt.rows.filter((r) => r.item === "행사철수");
    expect(special).toHaveLength(1);
    expect(special[0].note_amount).toBe(45000);
    expect(special[0].metro_fee).toBe(0);
    expect(special[0].regional_fee).toBe(0);
    expect(special[0].delivery_fee).toBe(45000);
    // 일반 행은 그대로
    expect(stmt.rows.filter((r) => r.item === "일반")).toHaveLength(1);
    // 총액 = 행사철수 45,000 + 일반 5,000
    expect(stmt.feeTotal).toBe(50000);
  });

  it("다른 날짜의 행사철수는 별도로 합산", () => {
    const leaders = [mkLeader("L1", "A")];
    const deliveries: StmtDelivery[] = [
      mkRow({ date: "2026-06-05", item: "행사철수", note_amount: 10000, leader1_id: "L1" }),
      mkRow({ date: "2026-06-07", item: "행사철수", note_amount: 30000, leader1_id: "L1" }),
    ];
    const [stmt] = buildCompanyStatements(deliveries, [company], leaders, "h1");
    const special = stmt.rows.filter((r) => r.item === "행사철수");
    expect(special).toHaveLength(2);
    expect(special.map((r) => r.note_amount).sort()).toEqual([10000, 30000]);
  });

  it("행사철수에 수도권배송비 입력 시 무시되고 경고 생성", () => {
    const leaders = [mkLeader("L1", "A")];
    const deliveries: StmtDelivery[] = [
      mkRow({ item: "행사철수", note_amount: 10000, metro_fee: 7000, leader1_id: "L1" }),
    ];
    const [stmt] = buildCompanyStatements(deliveries, [company], leaders, "h1");
    expect(stmt.rows[0].metro_fee).toBe(0);
    expect(stmt.rows[0].delivery_fee).toBe(10000);
    expect(stmt.warnings.some((w) => w.includes("무시"))).toBe(true);
  });
});