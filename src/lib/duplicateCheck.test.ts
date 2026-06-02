import { describe, it, expect } from "vitest";
import {
  findExactDuplicates,
  findSuspectDuplicates,
  formatDuplicateConfirm,
  findBulkDuplicates,
  summarizeBulk,
  groupSuspectDuplicates,
  type DupDelivery,
} from "./duplicateCheck";

const base = (over: Partial<DupDelivery> = {}): DupDelivery => ({
  id: "ex1",
  date: "2026-05-12",
  company_id: "c1",
  company_name: "업체A",
  customer_name: "홍길동",
  region: "강남구",
  item: "식탁",
  metro_fee: 100000,
  note_amount: 0,
  regional_fee: 0,
  cod_amount: 0,
  leader1_id: "L1",
  leader2_id: null,
  split_type: null,
  two_person: false,
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

  it("배송지(region)가 다르면 의심도 아님", () => {
    const existing = [base({ id: "ex1", region: "강남구" })];
    const cand = base({ id: null, region: "송파구" });
    expect(findSuspectDuplicates(cand, existing)).toHaveLength(0);
    expect(findExactDuplicates(cand, existing)).toHaveLength(0);
  });

  it("2인배송(two_person) 값이 다르면 완전 중복 아님", () => {
    const existing = [base({ id: "ex1", two_person: false })];
    const cand = base({ id: null, two_person: true });
    expect(findExactDuplicates(cand, existing)).toHaveLength(0);
    expect(findSuspectDuplicates(cand, existing)).toHaveLength(1);
  });

  it("비고(note)만 달라도 완전 중복으로 본다", () => {
    const existing = [base({ id: "ex1", note: "메모A" })];
    const cand = base({ id: null, note: "메모B" });
    expect(findExactDuplicates(cand, existing)).toHaveLength(1);
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

  it("findBulkDuplicates 는 기존 데이터와의 중복을 모아준다", () => {
    const existing = [base({ id: "ex1" }), base({ id: "ex2", customer_name: "김철수" })];
    const candidates = [
      base({ id: null }), // ex1 과 정확 중복
      base({ id: null, customer_name: "김철수", cod_amount: 5000 }), // ex2 와 의심 중복
      base({ id: null, customer_name: "신규고객" }), // 중복 없음
    ];
    const { exact, suspect } = findBulkDuplicates(candidates, existing);
    expect(exact).toHaveLength(1);
    expect(exact[0].id).toBe("ex1");
    expect(suspect).toHaveLength(1);
    expect(suspect[0].id).toBe("ex2");
  });

  it("findBulkDuplicates 는 후보끼리의 중복도 잡는다", () => {
    const candidates = [
      base({ id: null, customer_name: "동일고객" }),
      base({ id: null, customer_name: "동일고객" }),
    ];
    const { exact, suspect } = findBulkDuplicates(candidates, []);
    // 두 후보가 서로 정확 중복 → 매치 합계 ≥ 1
    expect(exact.length + suspect.length).toBeGreaterThan(0);
  });

  it("findBulkDuplicates 는 중복 없으면 빈 결과", () => {
    const candidates = [base({ id: null, customer_name: "A" }), base({ id: null, customer_name: "B" })];
    const { exact, suspect } = findBulkDuplicates(candidates, []);
    expect(exact).toHaveLength(0);
    expect(suspect).toHaveLength(0);
  });

  it("summarizeBulk 는 완전중복을 제외하고 신규/유사를 분리한다", () => {
    const existing = [base({ id: "ex1" })];
    const candidates = [
      base({ id: null }), // ex1 과 완전 중복 → 제외
      base({ id: null, customer_name: "유사A", cod_amount: 5000 }),
      base({ id: null, customer_name: "신규A", region: "신규동" }),
    ];
    const s = summarizeBulk(candidates, existing);
    expect(s.total).toBe(3);
    expect(s.exactDupCount).toBe(1);
    expect(s.newCount + s.suspectCount).toBe(2);
    expect(s.newRows.find((r) => r.customer_name === "신규A")).toBeTruthy();
  });

  it("summarizeBulk 는 후보끼리의 정확 중복은 첫건만 신규로 살린다", () => {
    const candidates = [
      base({ id: null, customer_name: "동일" }),
      base({ id: null, customer_name: "동일" }),
      base({ id: null, customer_name: "동일" }),
    ];
    const s = summarizeBulk(candidates, []);
    expect(s.newCount).toBe(1);
    expect(s.exactDupCount).toBe(2);
  });
});
