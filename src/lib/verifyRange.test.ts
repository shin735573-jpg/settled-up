import { describe, expect, it } from "vitest";
import { getVerifyRange, normalizeMonthInput, parseMonthInput } from "./verifyRange";

describe("verifyRange", () => {
  it("parseMonthInput: 정상 YYYY-MM 파싱", () => {
    expect(parseMonthInput("2026-05")).toEqual({ year: 2026, month1: 5 });
    expect(parseMonthInput("2026-12")).toEqual({ year: 2026, month1: 12 });
  });
  it("parseMonthInput: 잘못된 입력은 null", () => {
    expect(parseMonthInput("")).toBeNull();
    expect(parseMonthInput("2026-13")).toBeNull();
    expect(parseMonthInput("2026-00")).toBeNull();
  });

  it("2026-05 월전체: 2026-05-01 ~ 2026-06-01 (exclusive)", () => {
    const r = getVerifyRange("2026-05", "all")!;
    expect(r.from).toBe("2026-05-01");
    expect(r.toExclusive).toBe("2026-06-01");
    expect(r.periodKey).toBe("all");
    expect(r.commonPeriodKeys).toEqual(["2026-05-first", "2026-05-second"]);
  });

  it("2026-05 1~15일: 2026-05-01 ~ 2026-05-16 (exclusive)", () => {
    const r = getVerifyRange("2026-05", "h1")!;
    expect(r.from).toBe("2026-05-01");
    expect(r.toExclusive).toBe("2026-05-16");
    expect(r.periodKey).toBe("2026-05-first");
    expect(r.commonPeriodKeys).toEqual(["2026-05-first"]);
  });

  it("2026-05 16~말일: 2026-05-16 ~ 2026-06-01 (exclusive)", () => {
    const r = getVerifyRange("2026-05", "h2")!;
    expect(r.from).toBe("2026-05-16");
    expect(r.toExclusive).toBe("2026-06-01");
    expect(r.periodKey).toBe("2026-05-second");
    expect(r.commonPeriodKeys).toEqual(["2026-05-second"]);
  });

  it("12월 경계: 2026-12 월전체는 2027-01-01 미만", () => {
    const r = getVerifyRange("2026-12", "all")!;
    expect(r.from).toBe("2026-12-01");
    expect(r.toExclusive).toBe("2027-01-01");
  });

  it("12월 16~말일: 2026-12-16 ~ 2027-01-01", () => {
    const r = getVerifyRange("2026-12", "h2")!;
    expect(r.from).toBe("2026-12-16");
    expect(r.toExclusive).toBe("2027-01-01");
  });

  it("잘못된 월 입력은 null", () => {
    expect(getVerifyRange("", "all")).toBeNull();
    expect(getVerifyRange("bad", "h1")).toBeNull();
  });

  it("normalizeMonthInput: 다양한 입력 표기를 YYYY-MM 으로 보정", () => {
    expect(normalizeMonthInput("2026-05")).toBe("2026-05");
    expect(normalizeMonthInput("2026-5")).toBe("2026-05");
    expect(normalizeMonthInput("2026/05")).toBe("2026-05");
    expect(normalizeMonthInput("2026.5")).toBe("2026-05");
    expect(normalizeMonthInput("202605")).toBe("2026-05");
    expect(normalizeMonthInput("20265")).toBe("2026-05");
    expect(normalizeMonthInput("2026년 5월")).toBe("2026-05");
    expect(normalizeMonthInput("2026년 05월")).toBe("2026-05");
    expect(normalizeMonthInput(" 2026 - 05 ")).toBe("2026-05");
    expect(normalizeMonthInput("2026-12")).toBe("2026-12");
    expect(normalizeMonthInput("")).toBeNull();
    expect(normalizeMonthInput(null)).toBeNull();
    expect(normalizeMonthInput("2026-13")).toBeNull();
    expect(normalizeMonthInput("2026-00")).toBeNull();
  });

  it("getVerifyRange: 변형 입력도 동일 범위 반환", () => {
    const a = getVerifyRange("2026년 5월", "all")!;
    expect(a.from).toBe("2026-05-01");
    expect(a.toExclusive).toBe("2026-06-01");
    expect(a.commonPeriodKeys).toEqual(["2026-05-first", "2026-05-second"]);
    const b = getVerifyRange("202605", "h1")!;
    expect(b.from).toBe("2026-05-01");
    expect(b.toExclusive).toBe("2026-05-16");
    expect(b.periodKey).toBe("2026-05-first");
  });
});