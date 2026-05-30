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

describe("신동석 재분배", () => {
  const opts = { shindongseokId: "SDS", ganghyungjuId: "GHJ" };

  it("신동석 단독: 강형주 50% + 신동석 50%", () => {
    const r = allocateRow(base({ leader1_id: "SDS", metro_fee: 200000 }), opts);
    expect(r.length).toBe(2);
    const ghj = r.find((x) => x.leader_id === "GHJ")!;
    const sds = r.find((x) => x.leader_id === "SDS")!;
    expect(ghj.metro).toBe(100000);
    expect(sds.metro).toBe(100000);
    expect(ghj.weight + sds.weight).toBeCloseTo(1);
    expect(ghj.reason).toMatch(/신동석 몫 재분배 50%/);
  });

  it("신동석+다른 팀장 2인배송: 다른 50%, 강형주 25%, 신동석 25%", () => {
    const r = allocateRow(
      base({ leader1_id: "OD", leader2_id: "SDS", two_person: true, metro_fee: 200000 }),
      opts,
    );
    expect(r.length).toBe(3);
    const od = r.find((x) => x.leader_id === "OD")!;
    const ghj = r.find((x) => x.leader_id === "GHJ")!;
    const sds = r.find((x) => x.leader_id === "SDS")!;
    expect(od.metro).toBe(100000);
    expect(ghj.metro).toBe(50000);
    expect(sds.metro).toBe(50000);
    expect(od.weight + ghj.weight + sds.weight).toBeCloseTo(1);
  });

  it("형주동석 split은 재분배 건너뜀", () => {
    const r = allocateRow(
      base({ leader1_id: "GHJ", leader2_id: "SDS", split_type: "형주동석", metro_fee: 80000 }),
      opts,
    );
    expect(r.length).toBe(2);
    expect(r.find((x) => x.leader_id === "GHJ")!.metro).toBe(40000);
    expect(r.find((x) => x.leader_id === "SDS")!.metro).toBe(40000);
  });

  it("최종 비율 합계 = 100% (2인배송)", () => {
    const r = allocateRow(
      base({ leader1_id: "OD", leader2_id: "SDS", two_person: true,
             metro_fee: 100, note_amount: 50, regional_fee: 20, cod_amount: 10 }),
      opts,
    );
    const sum = r.reduce((s, x) => s + x.metro + x.note_amount + x.regional, 0);
    expect(sum).toBeCloseTo(170);
    expect(r.reduce((s, x) => s + x.cod, 0)).toBeCloseTo(10);
  });

  it("강형주 단독: 강형주 50% + 신동석 50% (대칭)", () => {
    const r = allocateRow(base({ leader1_id: "GHJ", metro_fee: 200000 }), opts);
    expect(r.length).toBe(2);
    expect(r.find((x) => x.leader_id === "GHJ")!.metro).toBe(100000);
    expect(r.find((x) => x.leader_id === "SDS")!.metro).toBe(100000);
  });

  it("김용익+강형주 2인배송: 김 50%, 강 25%, 신 25%", () => {
    const r = allocateRow(
      base({ leader1_id: "KYI", leader2_id: "GHJ", two_person: true, metro_fee: 200000 }),
      opts,
    );
    expect(r.length).toBe(3);
    expect(r.find((x) => x.leader_id === "KYI")!.metro).toBe(100000);
    expect(r.find((x) => x.leader_id === "GHJ")!.metro).toBe(50000);
    expect(r.find((x) => x.leader_id === "SDS")!.metro).toBe(50000);
  });

  it("강형주+신동석 같이 입력(2인배송): 중복 없이 50/50", () => {
    const r = allocateRow(
      base({ leader1_id: "GHJ", leader2_id: "SDS", two_person: true, metro_fee: 200000 }),
      opts,
    );
    expect(r.length).toBe(2);
    expect(r.find((x) => x.leader_id === "GHJ")!.metro).toBe(100000);
    expect(r.find((x) => x.leader_id === "SDS")!.metro).toBe(100000);
  });

  it("강형주+신동석 같이 입력(기본): 중복 없이 50/50", () => {
    const r = allocateRow(
      base({ leader1_id: "GHJ", leader2_id: "SDS", metro_fee: 200000 }),
      opts,
    );
    expect(r.length).toBe(2);
    expect(r.find((x) => x.leader_id === "GHJ")!.metro).toBe(100000);
    expect(r.find((x) => x.leader_id === "SDS")!.metro).toBe(100000);
  });
});