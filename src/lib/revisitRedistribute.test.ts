import { describe, it, expect } from "vitest";
import { computeRevisitRedistribution, getRevisitFeeForLeader } from "./revisitRedistribute";

const row = (over: Record<string, unknown>) => ({
  id: "row-" + Math.random().toString(36).slice(2, 8),
  leader1_id: null,
  metro_fee: 0,
  regional_fee: 0,
  note_amount: 0,
  cod_amount: 0,
  revisit_group_id: null,
  revisit_visit_no: 1,
  revisit_manual_shares: null,
  ...over,
});

describe("computeRevisitRedistribution", () => {
  it("재방문 그룹 없으면 빈 맵", () => {
    const map = computeRevisitRedistribution([row({}), row({})]);
    expect(map.size).toBe(0);
  });

  it("1차 130k 지방 / 2차 65k 지방 → 1차=65k, 2차 빈 배열", () => {
    const r1 = row({ id: "p", leader1_id: "A", regional_fee: 130000, revisit_group_id: "g", revisit_visit_no: 1 });
    const r2 = row({ id: "s", leader1_id: "B", regional_fee: 65000, revisit_group_id: "g", revisit_visit_no: 2 });
    const map = computeRevisitRedistribution([r1, r2]);
    expect(map.get("s")).toEqual([]);
    const sh = map.get("p")!;
    const A = sh.find((x) => x.leader_id === "A")!;
    const B = sh.find((x) => x.leader_id === "B")!;
    expect(A.regional).toBe(65000);
    expect(B.regional).toBe(65000);
    expect(A.metro + B.metro).toBe(0);
  });

  it("수도권 기준일 때 metro 분배", () => {
    const r1 = row({ id: "p", leader1_id: "A", metro_fee: 200000, revisit_group_id: "g", revisit_visit_no: 1 });
    const r2 = row({ id: "s", leader1_id: "B", metro_fee: 80000, revisit_group_id: "g", revisit_visit_no: 2 });
    const sh = computeRevisitRedistribution([r1, r2]).get("p")!;
    expect(sh.find((x) => x.leader_id === "A")!.metro).toBe(120000);
    expect(sh.find((x) => x.leader_id === "B")!.metro).toBe(80000);
  });

  it("비고/착불은 1차 팀장1 고정", () => {
    const r1 = row({ id: "p", leader1_id: "A", regional_fee: 100000, note_amount: 20000, cod_amount: 5000, revisit_group_id: "g", revisit_visit_no: 1 });
    const r2 = row({ id: "s", leader1_id: "B", regional_fee: 30000, revisit_group_id: "g", revisit_visit_no: 2 });
    const sh = computeRevisitRedistribution([r1, r2]).get("p")!;
    const A = sh.find((x) => x.leader_id === "A")!;
    expect(A.note_amount).toBe(20000);
    expect(A.cod).toBe(5000);
    expect(A.regional).toBe(70000);
  });

  it("동일 팀장이 1·2차 모두 담당하면 차감 없음", () => {
    const r1 = row({ id: "p", leader1_id: "A", regional_fee: 100000, revisit_group_id: "g", revisit_visit_no: 1 });
    const r2 = row({ id: "s", leader1_id: "A", regional_fee: 40000, revisit_group_id: "g", revisit_visit_no: 2 });
    const sh = computeRevisitRedistribution([r1, r2]).get("p")!;
    expect(sh.length).toBe(1);
    expect(sh[0].regional).toBe(100000);
  });

  it("가상기사가 1차 팀장이면 override=[] (정산 제외)", () => {
    const r1 = row({ id: "p", leader1_id: "V", regional_fee: 100000, revisit_group_id: "g", revisit_visit_no: 1 });
    const r2 = row({ id: "s", leader1_id: "B", regional_fee: 40000, revisit_group_id: "g", revisit_visit_no: 2 });
    const sh = computeRevisitRedistribution([r1, r2], new Set(["V"])).get("p");
    expect(sh).toEqual([]);
  });

  it("수기분배 우선", () => {
    const r1 = row({
      id: "p", leader1_id: "A", regional_fee: 100000, note_amount: 5000,
      revisit_group_id: "g", revisit_visit_no: 1,
      revisit_manual_shares: [{ leader_id: "A", amount: 30000 }, { leader_id: "B", amount: 70000 }],
    });
    const r2 = row({ id: "s", leader1_id: "B", regional_fee: 60000, revisit_group_id: "g", revisit_visit_no: 2 });
    const sh = computeRevisitRedistribution([r1, r2]).get("p")!;
    expect(sh.find((x) => x.leader_id === "A" && x.regional === 30000)).toBeTruthy();
    expect(sh.find((x) => x.leader_id === "B" && x.regional === 70000)).toBeTruthy();
    // 비고는 1차 팀장1
    expect(sh.find((x) => x.leader_id === "A" && x.note_amount === 5000)).toBeTruthy();
  });
});

describe("getRevisitFeeForLeader", () => {
  const r1 = row({ id: "p", leader1_id: "A", regional_fee: 130000, revisit_group_id: "g", revisit_visit_no: 1 });
  const r2 = row({ id: "s", leader1_id: "B", regional_fee: 65000, revisit_group_id: "g", revisit_visit_no: 2 });
  const map = computeRevisitRedistribution([r1, r2]);

  it("재방문 1차 행 — 팀장 A 관점에서 65k", () => {
    const fee = getRevisitFeeForLeader("p", map, new Set(["A"]));
    expect(fee?.regional).toBe(65000);
  });
  it("재방문 2차 행 — null (모든 팀장 관점에서 숨김)", () => {
    expect(getRevisitFeeForLeader("s", map, new Set(["A"]))).toBeNull();
    expect(getRevisitFeeForLeader("s", map, new Set(["B"]))).toBeNull();
  });
  it("관련 없는 팀장 → null", () => {
    expect(getRevisitFeeForLeader("p", map, new Set(["X"]))).toBeNull();
  });
  it("재방문 아닌 행 → undefined", () => {
    const other = row({ id: "x" });
    expect(getRevisitFeeForLeader(other.id, map, new Set(["A"]))).toBeUndefined();
  });
});