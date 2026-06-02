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

/**
 * 다양한 월 입력 표기를 안전하게 "YYYY-MM" 으로 정규화.
 *   "2026-05", "2026-5", "2026/05", "2026.05",
 *   "202605", "2026년 5월", "2026 년 05 월" 등 모두 "2026-05".
 * 브라우저 지역화/사용자 입력 변형을 흡수한다.
 * 시간대(Date.toISOString) 를 쓰지 않고 순수 문자열/숫자 기반.
 */
export function normalizeMonthInput(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  // 한글/공백/구분자 제거 후 숫자만 추출
  const digits = s.replace(/[^\d]/g, "");
  let year: number | null = null;
  let month1: number | null = null;
  // 우선: 명시적 구분자가 있는 YYYY[-/.]MM
  const m = /^(\d{4})\s*[-/.년 ]\s*(\d{1,2})/.exec(s);
  if (m) {
    year = Number(m[1]);
    month1 = Number(m[2]);
  } else if (digits.length === 6) {
    // 202605
    year = Number(digits.slice(0, 4));
    month1 = Number(digits.slice(4, 6));
  } else if (digits.length === 5) {
    // 20265 → 2026-5
    year = Number(digits.slice(0, 4));
    month1 = Number(digits.slice(4));
  }
  if (year == null || month1 == null) return null;
  if (!Number.isFinite(year) || !Number.isFinite(month1)) return null;
  if (year < 1900 || year > 9999) return null;
  if (month1 < 1 || month1 > 12) return null;
  return `${year}-${pad(month1)}`;
}

/** "YYYY-MM" → {year, month1} (month1 is 1-based). 다양한 변형 입력도 수용. null on invalid. */
export function parseMonthInput(monthStr: string): { year: number; month1: number } | null {
  const norm = normalizeMonthInput(monthStr);
  if (!norm) return null;
  const [y, m] = norm.split("-");
  return { year: Number(y), month1: Number(m) };
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
  const normMonth = `${year}-${pad(month1)}`;
  const first = ymd(year, month1, 1);
  const sixteenth = ymd(year, month1, 16);
  const nextFirst = nextMonthFirst(year, month1);

  const periodKey =
    period === "all" ? "all" : `${normMonth}-${period === "h1" ? "first" : "second"}`;
  const commonPeriodKeys =
    period === "all"
      ? [`${normMonth}-first`, `${normMonth}-second`]
      : [`${normMonth}-${period === "h1" ? "first" : "second"}`];

  if (period === "h1") return { from: first, toExclusive: sixteenth, periodKey, commonPeriodKeys };
  if (period === "h2") return { from: sixteenth, toExclusive: nextFirst, periodKey, commonPeriodKeys };
  return { from: first, toExclusive: nextFirst, periodKey, commonPeriodKeys };
}