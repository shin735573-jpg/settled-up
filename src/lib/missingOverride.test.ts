import { describe, it, expect } from "vitest";
import {
  parseMissingReason,
  buildMissingReason,
  hasSettlementOverride,
  getEffectiveSettleDate,
  isInEffectivePeriod,
} from "./missingOverride";

describe("missingOverride", () => {
  it("round-trips reason + month + half", () => {
    const s = buildMissingReason({ settleMonth: "2026-05", half: "H1", reason: "사유 텍스트" });
    expect(s).toBe("[SETTLE:2026-05:H1] 사유 텍스트");
    const p = parseMissingReason(s);
    expect(p.settleMonth).toBe("2026-05");
    expect(p.half).toBe("H1");
    expect(p.reason).toBe("사유 텍스트");
  });

  it("handles legacy reason without prefix", () => {
    const p = parseMissingReason("그냥 텍스트");
    expect(p.settleMonth).toBeNull();
    expect(p.half).toBeNull();
    expect(p.reason).toBe("그냥 텍스트");
    expect(hasSettlementOverride({ missing_reason: "그냥 텍스트" })).toBe(false);
  });

  it("FULL half builds without ambiguity", () => {
    const s = buildMissingReason({ settleMonth: "2026-05", half: "FULL", reason: "" });
    expect(s).toBe("[SETTLE:2026-05:FULL]");
    expect(parseMissingReason(s).half).toBe("FULL");
  });

  it("getEffectiveSettleDate uses override month + half (1일/16일)", () => {
    expect(getEffectiveSettleDate({ date: "2026-04-20", missing_reason: "[SETTLE:2026-05:H1] x" }))
      .toBe("2026-05-01");
    expect(getEffectiveSettleDate({ date: "2026-04-20", missing_reason: "[SETTLE:2026-05:H2] x" }))
      .toBe("2026-05-16");
    expect(getEffectiveSettleDate({ date: "2026-04-20", missing_reason: null }))
      .toBe("2026-04-20");
  });

  it("isInEffectivePeriod: override 우선, 원래 date 는 무시", () => {
    const d = { date: "2026-04-20", missing_reason: "[SETTLE:2026-05:H2] 누락" };
    expect(isInEffectivePeriod(d, "2026-04", "all")).toBe(false);
    expect(isInEffectivePeriod(d, "2026-05", "h1")).toBe(false);
    expect(isInEffectivePeriod(d, "2026-05", "h2")).toBe(true);
    expect(isInEffectivePeriod(d, "2026-05", "all")).toBe(true);
  });

  it("isInEffectivePeriod: 일반 건은 date 기준", () => {
    const d = { date: "2026-05-08", missing_reason: null };
    expect(isInEffectivePeriod(d, "2026-05", "h1")).toBe(true);
    expect(isInEffectivePeriod(d, "2026-05", "h2")).toBe(false);
    expect(isInEffectivePeriod(d, "2026-05", "all")).toBe(true);
    expect(isInEffectivePeriod(d, "2026-04", "all")).toBe(false);
  });

  it("override FULL 은 두 반기 모두에 포함", () => {
    const d = { date: "2026-03-01", missing_reason: "[SETTLE:2026-05:FULL]" };
    expect(isInEffectivePeriod(d, "2026-05", "h1")).toBe(true);
    expect(isInEffectivePeriod(d, "2026-05", "h2")).toBe(true);
    expect(isInEffectivePeriod(d, "2026-05", "all")).toBe(true);
  });
});
