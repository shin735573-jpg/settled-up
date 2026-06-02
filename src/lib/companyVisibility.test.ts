import { describe, it, expect } from "vitest";
import { filterVisibleCompanies } from "./companyVisibility";

const C = {
  slipMonthly: { id: "c-slip-m", name: "슬립웨이(월)", settlement_cycle: "monthly" },
  slipBiweekly: { id: "c-slip-b", name: "슬립웨이(보름)", settlement_cycle: "biweekly" },
  acmeMonthly: { id: "c-acme", name: "ACME", settlement_cycle: "monthly" },
  betaBiweekly: { id: "c-beta", name: "베타", settlement_cycle: "biweekly" },
};
const all = [C.slipMonthly, C.slipBiweekly, C.acmeMonthly, C.betaBiweekly];

const row = (company_id: string) => ({ company_id, company_name: null });

describe("filterVisibleCompanies", () => {
  it("전체/월전체에서는 모든 업체를 표시한다", () => {
    expect(filterVisibleCompanies(all, "all", [], []).map((c) => c.id)).toEqual(all.map((c) => c.id));
    expect(filterVisibleCompanies(all, "month", [], []).map((c) => c.id)).toEqual(all.map((c) => c.id));
  });

  it("1~15일(first): 보름 업체는 항상 표시, 월 업체는 기간 데이터가 있을 때만 표시", () => {
    const periodRows = [row(C.slipMonthly.id)]; // 슬립웨이(월)에 1~15일 행 존재
    const out = filterVisibleCompanies(all, "first", periodRows, []);
    const ids = out.map((c) => c.id);
    expect(ids).toContain(C.slipBiweekly.id); // 보름은 항상
    expect(ids).toContain(C.betaBiweekly.id); // 보름은 항상
    expect(ids).toContain(C.slipMonthly.id);  // 기간 행 존재 → 표시
    expect(ids).not.toContain(C.acmeMonthly.id); // 데이터 없음 → 숨김
  });

  it("16~말일(second): 월 업체에 이월착불행만 있어도 표시한다", () => {
    const carryRows = [row(C.acmeMonthly.id)];
    const ids = filterVisibleCompanies(all, "second", [], carryRows).map((c) => c.id);
    expect(ids).toContain(C.acmeMonthly.id);
    expect(ids).toContain(C.slipBiweekly.id);
    expect(ids).not.toContain(C.slipMonthly.id);
  });

  it("보름 기간에 데이터 없는 월 업체는 숨겨진다", () => {
    const ids = filterVisibleCompanies(all, "first", [], []).map((c) => c.id);
    expect(ids).not.toContain(C.slipMonthly.id);
    expect(ids).not.toContain(C.acmeMonthly.id);
    expect(ids).toContain(C.slipBiweekly.id);
    expect(ids).toContain(C.betaBiweekly.id);
  });

  it("company_id 없이 company_name 폴백 매칭도 동작한다", () => {
    const periodRows = [{ company_id: null, company_name: "슬립웨이(월)" }];
    const ids = filterVisibleCompanies(all, "first", periodRows, []).map((c) => c.id);
    expect(ids).toContain(C.slipMonthly.id);
  });
});
