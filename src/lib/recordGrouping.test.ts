import { describe, it, expect } from "vitest";
import {
  groupByLooseKey,
  classifyGroupRow,
  recommendAction,
  validateMergePlan,
  buildUpdatePatches,
  type GroupRow,
} from "./recordGrouping";

const r = (o: Partial<GroupRow> & { id: string }): GroupRow => ({
  date: "2026-05-12",
  customer_name: "홍길동",
  region: "강남",
  item: "식탁",
  leader1_id: "L1",
  leader2_id: null,
  metro_fee: 100000,
  note_amount: 0,
  regional_fee: 0,
  cod_amount: 0,
  split_type: null,
  two_person: false,
  companion: false,
  paid: false,
  ...o,
});

describe("recordGrouping", () => {
  it("느슨한 키가 같은 행만 그룹화 (단건 제외)", () => {
    const groups = groupByLooseKey([r({ id: "a" }), r({ id: "b", leader1_id: "L2" }), r({ id: "c", customer_name: "다른" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("품목 다르면 다른 그룹", () => {
    const groups = groupByLooseKey([r({ id: "a" }), r({ id: "b", item: "쇼파" })]);
    expect(groups).toHaveLength(0);
  });

  it("classify: 완전 중복 표시", () => {
    const g = [r({ id: "a" }), r({ id: "b" })];
    expect(classifyGroupRow(g[0], g)).toContain("exact_duplicate");
  });

  it("classify: 2인배송인데 팀장2 없으면 불일치", () => {
    const row = r({ id: "a", two_person: true });
    expect(classifyGroupRow(row, [row])).toContain("two_person_mismatch");
  });

  it("classify: 팀장2 있고 2인배송 아니면 동행 확인 필요", () => {
    const row = r({ id: "a", leader2_id: "L2" });
    expect(classifyGroupRow(row, [row])).toContain("companion_needed");
  });

  it("classify: 같은 그룹의 다른 행에 팀장2 있고 본인은 없으면 누락 의심", () => {
    const g = [r({ id: "a" }), r({ id: "b", leader2_id: "L9" })];
    expect(classifyGroupRow(g[0], g)).toContain("leader2_missing");
  });

  it("recommend: 완전 중복 → dedupe", () => {
    const g = [r({ id: "a" }), r({ id: "b" })];
    expect(recommendAction(g)).toBe("dedupe");
  });

  it("recommend: 반반 분할 있으면 2인배송 통합", () => {
    const g = [r({ id: "a", split_type: "반반" }), r({ id: "b", leader1_id: "L2" })];
    expect(recommendAction(g)).toBe("merge_two_person");
  });

  it("recommend: 팀장1이 서로 다르면 동행 통합", () => {
    const g = [r({ id: "a" }), r({ id: "b", leader1_id: "L2", cod_amount: 1 })];
    expect(recommendAction(g)).toBe("merge_companion");
  });

  it("validate: 2인배송 통합은 팀장2 없어도 에러 없음 (자동 채움)", () => {
    const g = [r({ id: "a" })];
    const map = new Map([["k1", g]]);
    const issues = validateMergePlan(
      [{ groupKey: "k1", action: "merge_two_person", targetIds: ["a"] }],
      map,
    );
    expect(issues.find((x) => x.severity === "error")).toBeFalsy();
  });

  it("buildUpdatePatches: 동행 통합 시 companion=true, two_person=false (사유 입력 없음)", () => {
    const g = [r({ id: "a" }), r({ id: "b" })];
    const map = new Map([["k1", g]]);
    const patches = buildUpdatePatches(
      [{ groupKey: "k1", action: "merge_companion", targetIds: ["a", "b"] }],
      map,
    );
    expect(patches).toHaveLength(2);
    expect(patches[0].patch.companion).toBe(true);
    expect(patches[0].patch.two_person).toBe(false);
    expect(patches[0].patch.companion_reason).toBeUndefined();
  });

  it("buildUpdatePatches: 2인배송 통합 시 팀장2 없으면 채워줌", () => {
    const g = [r({ id: "a" })];
    const map = new Map([["k1", g]]);
    const patches = buildUpdatePatches(
      [{ groupKey: "k1", action: "merge_two_person", targetIds: ["a"], leader2Id: "L9" }],
      map,
    );
    expect(patches[0].patch.two_person).toBe(true);
    expect(patches[0].patch.leader2_id).toBe("L9");
  });
});