import { describe, it, expect } from "vitest";
import {
  validateRow,
  validateAll,
  detectDuplicates,
  comparePeriodTotals,
  periodRange,
  summarize,
  type DeliveryRecord,
  type ValidationContext,
} from "./recordValidation";

const ctx: ValidationContext = {
  companies: [{ id: "c1", name: "모던" }],
  leaders: [
    { id: "l1", name: "오동선", is_rejected: false },
    { id: "l2", name: "김용익", is_rejected: false },
    { id: "lr", name: "거부씨", is_rejected: true },
  ],
  holidays: [
    { date: "2026-05-05", scope: "hq", team_leader_id: null },
    { date: "2026-05-07", scope: "leader", team_leader_id: "l1" },
  ],
  classifyRegion: (s) => (s.includes("서울") ? "metro" : "regional"),
};

const base = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  id: "r1",
  date: "2026-05-11",
  company_id: "c1",
  company_name: "모던",
  leader1_id: "l1",
  leader1_name: "오동선",
  leader2_id: null,
  leader2_name: null,
  customer_name: "홍길동",
  region: "서울 강남구",
  region_type: "metro",
  item: "박스 2개",
  note: null,
  metro_fee: 10000,
  note_amount: 0,
  regional_fee: 0,
  cod_amount: 0,
  split_type: "",
  paid: false,
  ...over,
});

describe("validateRow", () => {
  it("정상행은 이슈 없음", () => {
    expect(validateRow(base(), ctx)).toEqual([]);
  });

  it("필수값 누락 감지", () => {
    const issues = validateRow(base({ date: null, customer_name: "", item: null }), ctx);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("missing.date");
    expect(codes).toContain("missing.customer");
    expect(codes).toContain("missing.item");
  });

  it("금액 음수 오류", () => {
    const issues = validateRow(base({ metro_fee: -100 }), ctx);
    expect(issues.some((i) => i.code === "amount.negative")).toBe(true);
  });

  it("금액 문자 오류, 빈칸은 OK", () => {
    const bad = validateRow(base({ note_amount: "abc" as any }), ctx);
    expect(bad.some((i) => i.code === "amount.invalid")).toBe(true);
    const ok = validateRow(base({ note_amount: "" as any }), ctx);
    expect(ok.some((i) => i.code === "amount.invalid")).toBe(false);
  });

  it("미등록 업체 경고", () => {
    const issues = validateRow(
      base({ company_id: null, company_name: "없는회사" }), ctx);
    expect(issues.some((i) => i.code === "company.unregistered" && i.severity === "warning")).toBe(true);
  });

  it("팀장2 빈칸은 오류 아님", () => {
    const issues = validateRow(base({ leader2_id: null, leader2_name: null }), ctx);
    expect(issues.some((i) => i.field === "팀장2")).toBe(false);
  });

  it("미등록 팀장1 경고", () => {
    const issues = validateRow(
      base({ leader1_id: null, leader1_name: "없는팀장" }), ctx);
    expect(issues.some((i) => i.code === "leader.unregistered")).toBe(true);
  });

  it("지역구분 불일치 경고", () => {
    const issues = validateRow(base({ region: "부산", region_type: "metro" }), ctx);
    expect(issues.some((i) => i.code === "region.mismatch")).toBe(true);
  });

  it("분할 허용값", () => {
    expect(validateRow(base({ split_type: "이상한값" }), ctx)
      .some((i) => i.code === "split.invalid")).toBe(true);
    expect(validateRow(base({ split_type: "3분할", leader2_id: "l2", leader2_name: "김용익" }), ctx)
      .some((i) => i.code === "split.invalid")).toBe(false);
  });

  it("3분할인데 팀장2 없으면 오류", () => {
    const issues = validateRow(base({ split_type: "3분할" }), ctx);
    expect(issues.some((i) => i.code === "split.3.leader2")).toBe(true);
  });

  it("거부팀장 경고", () => {
    const issues = validateRow(
      base({ leader1_id: "lr", leader1_name: "거부씨" }), ctx);
    expect(issues.some((i) => i.code === "leader.rejected")).toBe(true);
  });

  it("본사 휴무일 오류", () => {
    const issues = validateRow(base({ date: "2026-05-05" }), ctx);
    expect(issues.some((i) => i.code === "holiday.hq")).toBe(true);
  });

  it("팀장 휴무일 오류", () => {
    const issues = validateRow(base({ date: "2026-05-07" }), ctx);
    expect(issues.some((i) => i.code === "holiday.leader")).toBe(true);
  });
});

describe("detectDuplicates", () => {
  it("같은 키 두 번이면 중복 경고", () => {
    const rows = [base({ id: "a" }), base({ id: "b" })];
    const dup = detectDuplicates(rows);
    expect(dup.length).toBe(1);
    expect(dup[0].code).toBe("duplicate.suspect");
    expect(dup[0].rowId).toBe("b");
  });
  it("다른 고객명이면 중복 아님", () => {
    const rows = [base({ id: "a" }), base({ id: "b", customer_name: "다른" })];
    expect(detectDuplicates(rows).length).toBe(0);
  });
});

describe("periodRange / comparePeriodTotals", () => {
  it("1-15 / 16-말 경계", () => {
    expect(periodRange("2026-05", "1-15")).toEqual({ start: "2026-05-01", end: "2026-05-15" });
    expect(periodRange("2026-05", "16-end")).toEqual({ start: "2026-05-16", end: "2026-05-31" });
    expect(periodRange("2026-02", "16-end").end).toBe("2026-02-28");
  });

  it("팀장 미배정 행이 있으면 불일치", () => {
    const rows = [
      base({ id: "a", date: "2026-05-03", metro_fee: 10000 }),
      base({ id: "b", date: "2026-05-04", metro_fee: 5000,
             leader1_id: null, leader1_name: null }),
    ];
    const res = comparePeriodTotals(rows, "2026-05");
    const half = res.find((r) => r.period === "1-15")!;
    expect(half.companyTotal).toBe(15000);
    expect(half.leaderTotal).toBe(10000);
    expect(half.diff).toBe(5000);
    expect(half.status).toBe("불일치");
  });

  it("팀장 모두 배정시 정상", () => {
    const rows = [base({ date: "2026-05-03", metro_fee: 10000 })];
    const res = comparePeriodTotals(rows, "2026-05");
    expect(res.every((r) => r.status === "정상")).toBe(true);
  });
});

describe("summarize", () => {
  it("오류/경고/정상 카운트", () => {
    const rows = [
      base({ id: "a" }),                              // 정상
      base({ id: "b", date: null }),                  // 오류
      base({ id: "c", region: "부산", region_type: "metro" }), // 경고
    ];
    const issues = validateAll(rows, ctx);
    const s = summarize(issues, rows.length);
    expect(s.errorCount).toBe(1);
    expect(s.warningCount).toBe(1);
    expect(s.okCount).toBe(1);
  });
});
import { validateTeamParity } from "./recordValidation";

describe("validateTeamParity (강형주/신동석 팀 정합성)", () => {
  const leaders = [
    { id: "g", name: "강형주", aliases: ["형주"] },
    { id: "s", name: "신동석", aliases: ["동석"] },
    { id: "o", name: "오동선", aliases: [] },
  ];
  const ctx = { companies: [], leaders, holidays: [] } as any;

  const row = (over: any) => ({
    id: over.id || "r1", date: "2026-05-01", company_id: null, company_name: "X",
    leader1_id: null, leader1_name: null, leader2_id: null, leader2_name: null,
    customer_name: "C", region: null, region_type: null, item: "i", note: null,
    metro_fee: 0, note_amount: 0, regional_fee: 0, cod_amount: 0,
    split_type: null, paid: false, two_person: false, ...over,
  });

  it("신동석 단독 → 두 사람 동일 → 오류 없음", () => {
    const issues = validateTeamParity([row({ leader1_id: "s", metro_fee: 200000 })], ctx);
    expect(issues).toHaveLength(0);
  });
  it("강형주 단독 → 두 사람 동일 → 오류 없음", () => {
    const issues = validateTeamParity([row({ leader1_id: "g", metro_fee: 200000 })], ctx);
    expect(issues).toHaveLength(0);
  });
  it("오동선+신동석 2인배송 → 오류 없음", () => {
    const issues = validateTeamParity(
      [row({ leader1_id: "o", leader2_id: "s", two_person: true, metro_fee: 200000 })],
      ctx,
    );
    expect(issues).toHaveLength(0);
  });
  it("강형주+신동석 형주동석 분할 → 오류 없음 (중복 없음)", () => {
    const issues = validateTeamParity(
      [row({ leader1_id: "g", leader2_id: "s", split_type: "형주동석", metro_fee: 200000 })],
      ctx,
    );
    expect(issues).toHaveLength(0);
  });
  it("형주/동석 미포함 행은 검사 대상 아님", () => {
    const issues = validateTeamParity([row({ leader1_id: "o", metro_fee: 100000 })], ctx);
    expect(issues).toHaveLength(0);
  });
});

import { validateSettleRedirect } from "./recordValidation";

describe("validateSettleRedirect (오은규 → 오동선 특수정산)", () => {
  const leaders = [
    { id: "ds", name: "오동선", aliases: [] },
    { id: "ek", name: "오은규", aliases: [], settle_to_id: "ds" },
    { id: "yi", name: "김용익", aliases: [] },
  ];
  const ctx = { companies: [], leaders, holidays: [] } as any;
  const row = (over: any) => ({
    id: over.id || "r1", date: "2026-05-01", company_id: null, company_name: "X",
    leader1_id: null, leader1_name: null, leader2_id: null, leader2_name: null,
    customer_name: "C", region: null, region_type: null, item: "i", note: null,
    metro_fee: 0, note_amount: 0, regional_fee: 0, cod_amount: 0,
    split_type: null, paid: false, two_person: false, ...over,
  });

  it("오은규 단독 → 오류 없음 (오동선이 100% 합산)", () => {
    expect(validateSettleRedirect([row({ leader1_id: "ek", metro_fee: 100000 })], ctx)).toHaveLength(0);
  });
  it("오은규+김용익 2인배송 → 오류 없음", () => {
    expect(validateSettleRedirect(
      [row({ leader1_id: "ek", leader2_id: "yi", two_person: true, metro_fee: 200000 })],
      ctx,
    )).toHaveLength(0);
  });
  it("오은규+오동선 2인배송 → 오류 없음 (중복계산 아님)", () => {
    expect(validateSettleRedirect(
      [row({ leader1_id: "ek", leader2_id: "ds", two_person: true, metro_fee: 200000 })],
      ctx,
    )).toHaveLength(0);
  });
  it("정산귀속 대상이 없는 ID이면 오류", () => {
    const broken = { companies: [], leaders: [
      { id: "ek", name: "오은규", aliases: [], settle_to_id: "missing" },
    ], holidays: [] } as any;
    const issues = validateSettleRedirect([], broken);
    expect(issues.some((i) => i.code === "settle.target.missing")).toBe(true);
  });
});
