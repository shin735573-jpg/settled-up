import { describe, it, expect } from "vitest";
import { allocateRow, feeForShare } from "./splitAllocation";

const base = (over: Partial<Parameters<typeof allocateRow>[0]> = {}) => ({
  leader1_id: "l1", leader2_id: null, split_type: null, two_person: false,
  metro_fee: 0, note_amount: 0, regional_fee: 0, cod_amount: 0, ...over,
});

describe("allocateRow", () => {
  it("일반 + 팀장1만: 100% 팀장1", () => {
    const r = allocateRow(base({ metro_fee: 100000 }));
    expect(r.length).toBe(1);
    expect(r[0].leader_id).toBe("l1");
    expect(r[0].metro).toBe(100000);
    expect(r[0].weight).toBe(1);
  });

  it("2인배송 = 예 + 팀장1,2: 50/50 (테스트 1)", () => {
    const r = allocateRow(base({ leader2_id: "l2", two_person: true, metro_fee: 100000 }));
    expect(r.length).toBe(2);
    expect(r[0].metro).toBe(50000);
    expect(r[1].metro).toBe(50000);
    expect(r[0].count).toBe(1);
    expect(r[1].count).toBe(1);
  });

  it("3분할 우선 (테스트 2): 2/3, 1/3", () => {
    const r = allocateRow(base({ leader2_id: "l2", split_type: "3분할", two_person: true, metro_fee: 90000 }));
    expect(r[0].metro).toBeCloseTo(60000);
    expect(r[1].metro).toBeCloseTo(30000);
  });

  it("형주동석: 50/50", () => {
    const r = allocateRow(base({ leader2_id: "l2", split_type: "형주동석", metro_fee: 80000 }));
    expect(r[0].metro).toBe(40000);
    expect(r[1].metro).toBe(40000);
  });

  it("일반 + 팀장2 있음 + 2인배송 아니오: 팀장1 100%", () => {
    const r = allocateRow(base({ leader2_id: "l2", metro_fee: 100000 }));
    expect(r.length).toBe(1);
    expect(r[0].leader_id).toBe("l1");
    expect(r[0].metro).toBe(100000);
  });

  it("2인배송인데 팀장2 없음: 팀장1 100% (오류는 UI에서 차단)", () => {
    const r = allocateRow(base({ two_person: true, metro_fee: 100000 }));
    expect(r.length).toBe(1);
    expect(r[0].metro).toBe(100000);
  });
});

describe("feeForShare", () => {
  it("비고금액은 수수료 제외 — metro 50000 × 10% = 5000", () => {
    expect(feeForShare({ metro: 50000, regional: 0 }, { metro: 10, regional: 5 })).toBe(5000);
    expect(feeForShare({ metro: 0, regional: 20000 }, { metro: 10, regional: 5 })).toBe(1000);
  });
});