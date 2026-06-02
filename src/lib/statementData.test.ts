import { describe, it, expect } from "vitest";
import {
  buildCompanyStatements,
  buildLeaderStatements,
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
    // 최초 2명만 팀장 칸, 나머지는 비고에 (트리오 팀이 아니므로 팀장3 비어있음)
    expect(special[0].display_leader1).toBe("A팀장");
    expect(special[0].display_leader2).toBe("B팀장");
    expect(special[0].display_leader3).toBe("");
    expect(special[0].note).toContain("C팀장");
    expect(special[0].note).toContain("추가팀장");
    // 일반 행은 그대로
    expect(stmt.rows.filter((r) => r.item === "일반")).toHaveLength(1);
    // 총액 = 행사철수 45,000 + 일반 5,000
    expect(stmt.feeTotal).toBe(50000);
  });

  it("다른 고객명의 행사철수는 별도로 합산 (날짜와 무관)", () => {
    const leaders = [mkLeader("L1", "A")];
    const deliveries: StmtDelivery[] = [
      mkRow({ date: "2026-06-05", item: "행사철수", note_amount: 10000, leader1_id: "L1", customer_name: "행사A" }),
      mkRow({ date: "2026-06-07", item: "행사철수", note_amount: 30000, leader1_id: "L1", customer_name: "행사B" }),
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

  it("강형주/신동석/삼호도는 업체 청구서 팀장 표시에서 제외되지만 금액은 합산됨", () => {
    const leaders = [
      mkLeader("L1", "강형주"),
      mkLeader("L2", "신동석"),
      mkLeader("L3", "삼호도"),
      mkLeader("L4", "박팀장"),
      mkLeader("L5", "김팀장"),
    ];
    const deliveries: StmtDelivery[] = [
      mkRow({ item: "행사철수", leader1_id: "L1", leader1_name: "강형주", note_amount: 10000 }),
      mkRow({ item: "행사철수", leader1_id: "L2", leader1_name: "신동석", note_amount: 10000 }),
      mkRow({ item: "행사철수", leader1_id: "L3", leader1_name: "삼호도", note_amount: 12000 }),
      mkRow({ item: "행사철수", leader1_id: "L4", leader1_name: "박팀장", note_amount: 15000 }),
      mkRow({ item: "행사철수", leader1_id: "L5", leader1_name: "김팀장", note_amount: 20000 }),
    ];
    const [stmt] = buildCompanyStatements(deliveries, [company], leaders, "h1");
    expect(stmt.rows).toHaveLength(1);
    // 금액은 5명 전부 합산
    expect(stmt.rows[0].note_amount).toBe(67000);
    // 팀장 칸은 박팀장/김팀장만 (강형주, 신동석, 삼호도 제외)
    expect(stmt.rows[0].display_leader1).toBe("박팀장");
    expect(stmt.rows[0].display_leader2).toBe("김팀장");
    // 비고에도 강형주/신동석/삼호도 표시 안됨
    expect(stmt.rows[0].note ?? "").not.toContain("강형주");
    expect(stmt.rows[0].note ?? "").not.toContain("신동석");
    expect(stmt.rows[0].note ?? "").not.toContain("삼호도");
  });

  it("오동선/오은규/김용익 트리오 팀은 팀장3 칸까지 자동 채워짐", () => {
    const leaders = [
      mkLeader("L1", "오동선"),
      mkLeader("L2", "오은규"),
      mkLeader("L3", "김용익"),
    ];
    const deliveries: StmtDelivery[] = [
      mkRow({ item: "행사철수", leader1_id: "L1", leader1_name: "오동선", note_amount: 10000 }),
      mkRow({ item: "행사철수", leader1_id: "L2", leader1_name: "오은규", note_amount: 20000 }),
      mkRow({ item: "행사철수", leader1_id: "L3", leader1_name: "김용익", note_amount: 30000 }),
    ];
    const [stmt] = buildCompanyStatements(deliveries, [company], leaders, "h1");
    expect(stmt.rows).toHaveLength(1);
    const row = stmt.rows[0];
    expect(row.note_amount).toBe(60000);
    // 팀장1/2/3 모두 채워짐 (슬래시 합치기 아님)
    expect([row.display_leader1, row.display_leader2, row.display_leader3].sort())
      .toEqual(["김용익", "오동선", "오은규"].sort());
    // 비고에 추가팀장 텍스트 없음
    expect(row.note ?? "").not.toContain("추가팀장");
  });

  it("정책 변경(2026-06): 적재비도 팀장 정산서에 합산되며 항상 삼호 팀장에게 귀속된다", () => {
    const leaders = [mkLeader("L1", "삼호")];
    const deliveries: StmtDelivery[] = [
      mkRow({ item: "일반", leader1_id: "L1", leader1_name: "삼호", note_amount: 10000 }),
      // 다른 팀장이 입력돼 있어도 적재비는 삼호에게 자동 라우팅된다.
      mkRow({ item: "적재비", leader1_id: null, leader1_name: null, note_amount: 50000 }),
    ];
    const [stmt] = buildLeaderStatements(deliveries, leaders, "h1", { oeunkyuSpecial: true });
    expect(stmt.rows).toHaveLength(2);
    expect(stmt.realFee).toBe(60000);
  });

  it("재방문 그룹: 업체 청구는 1차만 표시, 2차 이후 금액은 업체에 청구하지 않음", () => {
    const leaders = [mkLeader("L1", "A팀장"), mkLeader("L2", "B팀장")];
    const deliveries: StmtDelivery[] = [
      mkRow({
        date: "2026-06-05", item: "일반", leader1_id: "L1", leader1_name: "A팀장",
        metro_fee: 50000, revisit_group_id: "g1", revisit_visit_no: 1,
      }),
      mkRow({
        date: "2026-06-12", item: "일반", leader1_id: "L2", leader1_name: "B팀장",
        metro_fee: 30000, revisit_group_id: "g1", revisit_visit_no: 2,
      }),
    ];
    const [stmt] = buildCompanyStatements(deliveries, [company], leaders, "h1");
    expect(stmt.rows).toHaveLength(1);
    expect(stmt.rows[0].metro_fee).toBe(50000);
    expect(stmt.rows[0].delivery_fee).toBe(50000);
    expect(stmt.rows[0].date).toBe("2026-06-05");
    expect(stmt.rows[0].display_leader1).toBe("A팀장");
    expect(stmt.feeTotal).toBe(50000);
  });

  it("재방문 그룹: 수기분배 미입력 시 2차 행 금액은 2차 팀장에게, 나머지는 1차 팀장에게 자동 분배", () => {
    const leaders = [mkLeader("L1", "A팀장"), mkLeader("L2", "B팀장")];
    const deliveries: StmtDelivery[] = [
      mkRow({
        date: "2026-06-05", item: "일반", leader1_id: "L1", leader1_name: "A팀장",
        metro_fee: 50000, revisit_group_id: "g1", revisit_visit_no: 1,
      }),
      mkRow({
        date: "2026-06-12", item: "일반", leader1_id: "L2", leader1_name: "B팀장",
        metro_fee: 30000, revisit_group_id: "g1", revisit_visit_no: 2,
      }),
    ];
    const stmts = buildLeaderStatements(deliveries, leaders, "h1", { oeunkyuSpecial: true });
    const a = stmts.find((s) => s.leader.id === "L1")!;
    const b = stmts.find((s) => s.leader.id === "L2")!;
    // 1차 청구 50,000원 = 1차 팀장(20,000) + 2차 팀장(30,000)
    expect(a.realFee).toBe(20000);
    expect(b.realFee).toBe(30000);
    expect(a.realFee + b.realFee).toBe(50000);
  });

  it("재방문 그룹: 수기분배 입력 시 각 팀장에게 지정 금액 분배", () => {
    const leaders = [mkLeader("L1", "A팀장"), mkLeader("L2", "B팀장")];
    const deliveries: StmtDelivery[] = [
      mkRow({
        date: "2026-06-05", item: "일반", leader1_id: "L1", leader1_name: "A팀장",
        metro_fee: 80000, revisit_group_id: "g1", revisit_visit_no: 1,
        revisit_manual_shares: [
          { leader_id: "L1", leader_name: "A팀장", amount: 50000 },
          { leader_id: "L2", leader_name: "B팀장", amount: 30000 },
        ],
        revisit_distributed: true,
      }),
      mkRow({
        date: "2026-06-12", item: "일반", leader1_id: "L2", leader1_name: "B팀장",
        metro_fee: 30000, revisit_group_id: "g1", revisit_visit_no: 2,
      }),
    ];
    const stmts = buildLeaderStatements(deliveries, leaders, "h1", { oeunkyuSpecial: true });
    const a = stmts.find((s) => s.leader.id === "L1")!;
    const b = stmts.find((s) => s.leader.id === "L2")!;
    expect(a.realFee).toBe(50000);
    expect(b.realFee).toBe(30000);
  });
});