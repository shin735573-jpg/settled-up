import { describe, it, expect } from "vitest";
import {
  resolveLeaderName,
  canonicalLeaderName,
  getDisplayName,
  detectDuplicates,
  findAliasConflict,
} from "./leaderResolver";

const leaders = [
  { id: "a", name: "강형주", aliases: ["형주"], display_suffix: null },
  { id: "b", name: "오동선", aliases: ["동선"], display_suffix: null },
  { id: "c", name: "오은규", aliases: ["은규"], display_suffix: null },
  { id: "d", name: "김민수", aliases: [], display_suffix: null },
  { id: "e", name: "김민수", aliases: [], display_suffix: "2" },
];

describe("resolveLeaderName", () => {
  it("정식 이름 매칭", () => {
    expect(resolveLeaderName("강형주", leaders)?.id).toBe("a");
  });
  it("별칭 매칭 (형주 → 강형주)", () => {
    expect(resolveLeaderName("형주", leaders)?.id).toBe("a");
    expect(resolveLeaderName(" 형주 ", leaders)?.id).toBe("a");
  });
  it("미등록은 null", () => {
    expect(resolveLeaderName("없는사람", leaders)).toBeNull();
    expect(resolveLeaderName("", leaders)).toBeNull();
  });
});

describe("canonicalLeaderName", () => {
  it("별칭을 정식 이름으로 정규화", () => {
    expect(canonicalLeaderName("형주", leaders)).toBe("강형주");
    expect(canonicalLeaderName("강형주", leaders)).toBe("강형주");
  });
  it("매칭 실패 시 입력값 trim", () => {
    expect(canonicalLeaderName(" 김갑돌 ", leaders)).toBe("김갑돌");
  });
});

describe("detectDuplicates / getDisplayName", () => {
  it("동명이인 카운트", () => {
    const m = detectDuplicates(leaders);
    expect(m.get("김민수")).toBe(2);
    expect(m.get("강형주")).toBe(1);
  });
  it("동명이인이면 suffix 붙음, 아니면 그대로", () => {
    expect(getDisplayName(leaders[0], leaders)).toBe("강형주");
    expect(getDisplayName(leaders[4], leaders)).toBe("김민수2");
  });
});

describe("findAliasConflict", () => {
  it("다른 팀장 정식이름과 충돌", () => {
    expect(findAliasConflict("a", ["오동선"], leaders)).toMatch(/오동선/);
  });
  it("다른 팀장 별칭과 충돌", () => {
    expect(findAliasConflict("a", ["동선"], leaders)).toMatch(/오동선/);
  });
  it("자기 자신은 충돌 아님", () => {
    expect(findAliasConflict("a", ["형주"], leaders)).toBeNull();
  });
  it("충돌 없음", () => {
    expect(findAliasConflict("a", ["형주왕"], leaders)).toBeNull();
  });
});