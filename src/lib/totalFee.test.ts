import { describe, it, expect } from "vitest";
import { totalDeliveryFee, rowDeliveryFee } from "./totalFee";

// 샘플 배송 데이터 — 다양한 형태(숫자/문자열/누락/0) 포함
const sample = [
  { metro_fee: 10000, note_amount: 0, regional_fee: 0, cod_amount: 5000, company_id: "c1", leader1_id: "l1" },
  { metro_fee: 0, note_amount: 3000, regional_fee: 7000, cod_amount: 0, company_id: "c1", leader1_id: "l2" },
  { metro_fee: "12000", note_amount: "0", regional_fee: "8000", cod_amount: 0, company_id: "c2", leader1_id: "l1" },
  { metro_fee: null, note_amount: 5000, regional_fee: null, cod_amount: 1000, company_id: "c2", leader1_id: null }, // 팀장 미배정
  { metro_fee: 4000, regional_fee: 6000, cod_amount: 0, company_id: "c3", leader1_id: "l3" },
];

// 업체정산 화면의 계산식 재현
const companySideTotal = (rows: typeof sample) =>
  rows.reduce(
    (s, r) =>
      s + (Number(r.metro_fee) || 0) + (Number(r.note_amount) || 0) + (Number(r.regional_fee) || 0),
    0,
  );

// 팀장정산 화면의 계산식 재현 (LeaderSettlement.sumFee + companyTotalFee)
const leaderSideTotal = (rows: typeof sample) => {
  const sumFee = (r: typeof sample[number]) =>
    (Number(r.metro_fee) || 0) + (Number(r.note_amount) || 0) + (Number(r.regional_fee) || 0);
  return rows.reduce((s, r) => s + sumFee(r), 0);
};

describe("총배송비 교차검증 (업체정산 ↔ 팀장정산)", () => {
  it("샘플 데이터에서 공통 헬퍼와 업체정산 계산식 결과가 같다", () => {
    expect(totalDeliveryFee(sample)).toBe(companySideTotal(sample));
  });

  it("샘플 데이터에서 공통 헬퍼와 팀장정산 계산식 결과가 같다", () => {
    expect(totalDeliveryFee(sample)).toBe(leaderSideTotal(sample));
  });

  it("업체정산 합 === 팀장정산 합 (항상 동일해야 함)", () => {
    expect(companySideTotal(sample)).toBe(leaderSideTotal(sample));
  });

  it("기대값 검증: 10000 + 10000 + 20000 + 5000 + 10000 = 55000", () => {
    expect(totalDeliveryFee(sample)).toBe(55000);
  });

  it("빈 배열은 0", () => {
    expect(totalDeliveryFee([])).toBe(0);
  });

  it("누락/문자열/null 값을 안전하게 0으로 처리", () => {
    expect(rowDeliveryFee({})).toBe(0);
    expect(rowDeliveryFee({ metro_fee: null, note_amount: undefined, regional_fee: "abc" as any })).toBe(0);
    expect(rowDeliveryFee({ metro_fee: "1500", note_amount: 500, regional_fee: null })).toBe(2000);
  });

  it("무작위 1000행 샘플에서도 두 화면 계산이 항상 일치", () => {
    const rand = () => Math.floor(Math.random() * 50000);
    const big = Array.from({ length: 1000 }, () => ({
      metro_fee: rand(),
      note_amount: Math.random() < 0.3 ? null : rand(),
      regional_fee: Math.random() < 0.5 ? `${rand()}` : rand(),
      cod_amount: rand(),
      company_id: `c${Math.floor(Math.random() * 10)}`,
      leader1_id: Math.random() < 0.1 ? null : `l${Math.floor(Math.random() * 5)}`,
    }));
    expect(companySideTotal(big as any)).toBe(leaderSideTotal(big as any));
    expect(totalDeliveryFee(big as any)).toBe(companySideTotal(big as any));
  });
});
