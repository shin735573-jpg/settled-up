import { describe, it, expect } from "vitest";
import {
  findExactDuplicates,
  findSuspectDuplicates,
  formatDuplicateConfirm,
  type DupDelivery,
} from "./duplicateCheck";

const base = (over: Partial<DupDelivery> = {}): DupDelivery => ({
  id: "ex1",
  date: "2026-05-12",
  company_id: "c1",
  company_name: "업체A",
  customer_name: "홍길동",
  item: "식탁",
  metro_fee: 100000,
  note_amount: 0,
  regional_fee: 0,
  cod_amount: 0,
  leader1_id: "L1",
  leader2_id: null,
  split_type: null,
  paid: false,
  note: "",
  ...over,
});

describe("duplicateCheck", () => {
  it("모든 필드 동일 시 정확 중복", () => {
    const existing = [base({ id: "ex1" })];
    const cand = base({ id: null });
    const exact = findExactDuplicates(cand, existing);
    expect(exact).toHaveLength(1);
    expect(exact[0].id).toBe("ex1");
    // 의심 목록은 정확 중복 제외
    expect(findSuspectDuplicates(cand, existing)).toHaveLength(0);
  });

  it("배송합계 동일하지만 착불 다르면 의심", () => {
    const existing = [base({ id: "ex1", cod_amount: 0 })];
    const cand = base({ id: null, cod_amount: 50000 });
    expect(findExactDuplicates(cand, existing)).toHaveLength(0);
    expect(findSuspectDuplicates(cand, existing)).toHaveLength(1);
  });

  it("같은 id 는 비교에서 제외 (수정 케이스)", () => {
    const existing = [base({ id: "same" })];
    const cand = base({ id: "same" });
    expect(findExactDuplicates(cand, existing)).toHaveLength(0);
    expect(findSuspectDuplicates(cand, existing)).toHaveLength(0);
  });

  it("배송합계 다르면 의심도 아님", () => {
    const existing = [base({ id: "ex1", metro_fee: 100000 })];
    const cand = base({ id: null, metro_fee: 90000 });
    expect(findSuspectDuplicates(cand, existing)).toHaveLength(0);
  });

  it("formatDuplicateConfirm 은 빈 결과면 빈 문자열", () => {
    expect(formatDuplicateConfirm([], [])).toBe("");
  });

  it("formatDuplicateConfirm 은 카운트와 confirm 안내를 포함", () => {
    const existing = [base({ id: "ex1" })];
    const cand = base({ id: null, cod_amount: 1 });
    const suspect = findSuspectDuplicates(cand, existing);
    const msg = formatDuplicateConfirm([], suspect);
    expect(msg).toContain("의심 중복 1건");
    expect(msg).toContain("저장하시겠습니까");
  });
});
