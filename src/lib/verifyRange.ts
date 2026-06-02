// 검산 화면 전용 — 월/기간 입력값을 정확한 [from, toExclusive) 범위로 변환.
// 기존 정산 계산식과 무관하며 SQL 조회 범위 계산에만 쓰인다.

import type { PeriodKey } from "./statementData";

export type VerifyRange = {
  from: string;        // YYYY-MM-DD (inclusive)
  toExclusive: string; // YYYY-MM-DD (exclusive)
  periodKey: string;
  commonPeriodKeys: string[];
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m1: number, d: number) => `${y}-${pad(m1)}-${pad(d)}`;

/** "YYYY-MM" → {year, month1} (month1 is 1-based). null on invalid. */
export function parseMonthInput(monthStr: string): { year: number; month1: number } | null {
  if (!monthStr) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(monthStr.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month1)) return null;
  if (month1 < 1 || month1 > 12) return null;
  return { year, month1 };
}

/** 다음 달 1일 (YYYY-MM-DD) */
function nextMonthFirst(year: number, month1: number): string {
  const ny = month1 === 12 ? year + 1 : year;
  const nm = month1 === 12 ? 1 : month1 + 1;
  return ymd(ny, nm, 1);
}

export function getVerifyRange(monthStr: string, period: PeriodKey): VerifyRange | null {
  const p = parseMonthInput(monthStr);
  if (!p) return null;
  const { year, month1 } = p;
  const first = ymd(year, month1, 1);
  const sixteenth = ymd(year, month1, 16);
  const nextFirst = nextMonthFirst(year, month1);

  const periodKey =
    period === "all" ? "all" : `${monthStr}-${period === "h1" ? "first" : "second"}`;
  const commonPeriodKeys =
    period === "all"
      ? [`${monthStr}-first`, `${monthStr}-second`]
      : [`${monthStr}-${period === "h1" ? "first" : "second"}`];

  if (period === "h1") return { from: first, toExclusive: sixteenth, periodKey, commonPeriodKeys };
  if (period === "h2") return { from: sixteenth, toExclusive: nextFirst, periodKey, commonPeriodKeys };
  return { from: first, toExclusive: nextFirst, periodKey, commonPeriodKeys };
}