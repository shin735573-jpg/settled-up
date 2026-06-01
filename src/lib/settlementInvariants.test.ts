import { describe, it, expect } from "vitest";
import { validateSettlementInvariants } from "./settlementInvariants";
import type { CompanyStmtData, LeaderStmtData, StmtDelivery } from "./statementData";

const baseDelivery = (over: Partial<StmtDelivery> = {}): StmtDelivery => ({
  id: "d1", date: "2025-06-01",
  company_id: "c1", company_name: "A업체",
  leader1_id: "L1", leader1_name: "팀장1",
  leader2_id: null, leader2_name: null,
  leader3_id: null, leader3_name: null,
  customer_name: null, region: null, region_type: null,
  item: null, note: null,
  metro_fee: 10000, note_amount: 0, regional_fee: 0, cod_amount: 0,
  split_type: null, two_person: null, paid: false,
  ...over,
});

const emptyCS = (): CompanyStmtData => ({
  company: { id: "c1", name: "A업체", active: true, issues_invoice: true,
    vat_included: false, fee_rate_metro: 0, fee_rate_regional: 0,
    settlement_cycle: "biweekly", account_number: null, has_cod: true,
    rejected_leader_id: null, rejected_leader_id_2: null, rejected_leader_id_3: null },
  period: "h1", rows: [],
  feeTotal: 0, paidTotal: 0, unpaidTotal: 0, codTotal: 0,
  carryInCod: 0, carryOutCod: 0, realClaim: 0, loadingFee: 0,
  finalClaim: 0, vat: 0, claimWithVat: 0,
  warnings: [], errors: [],
});

describe("validateSettlementInvariants", () => {
  it("정상 데이터는 오류 없음", () => {
    const d = baseDelivery();
    const cs: CompanyStmtData = { ...emptyCS(), codTotal: 0 };
    const ls: LeaderStmtData[] = [];
    const r = validateSettlementInvariants([d], [cs], ls);
    expect(r.errors).toEqual([]);
  });

  it("region_type 불일치는 오류", () => {
    const d = baseDelivery({ region_type: "지방", metro_fee: 10000, regional_fee: 0 });
    const r = validateSettlementInvariants([d], [], []);
    expect(r.errors.some((e) => e.includes("[분류]"))).toBe(true);
  });

  it("업체 착불 합 불일치는 오류", () => {
    const d = baseDelivery({ cod_amount: 5000 });
    const cs: CompanyStmtData = { ...emptyCS(), codTotal: 3000 };
    const r = validateSettlementInvariants([d], [cs], []);
    expect(r.errors.some((e) => e.includes("[착불]"))).toBe(true);
  });
});