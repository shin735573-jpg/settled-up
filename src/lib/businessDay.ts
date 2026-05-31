// 영업일 / 정산마감일 계산 헬퍼
// - 일요일 제외
// - 본사휴무일 제외
// - 토요일은 본사휴무일이 아니면 영업일로 본다

export type HQHolidaySet = Set<string>; // "YYYY-MM-DD"

const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export function isBusinessDay(date: Date | string, hqHolidays: HQHolidaySet): boolean {
  const d = typeof date === "string" ? new Date(date + "T00:00:00") : date;
  if (d.getDay() === 0) return false; // 일요일
  if (hqHolidays.has(toISO(d))) return false; // 본사휴무
  return true;
}

/** 기준일 이전(포함)으로 거슬러 올라가며 최초의 영업일을 반환 */
export function lastBusinessDayOnOrBefore(date: Date | string, hqHolidays: HQHolidaySet): string {
  const d = typeof date === "string" ? new Date(date + "T00:00:00") : new Date(date);
  for (let i = 0; i < 60; i++) {
    if (isBusinessDay(d, hqHolidays)) return toISO(d);
    d.setDate(d.getDate() - 1);
  }
  return toISO(d);
}

/** 기준일 이후(포함)로 진행하며 최초의 영업일을 반환 */
export function nextBusinessDayOnOrAfter(date: Date | string, hqHolidays: HQHolidaySet): string {
  const d = typeof date === "string" ? new Date(date + "T00:00:00") : new Date(date);
  for (let i = 0; i < 60; i++) {
    if (isBusinessDay(d, hqHolidays)) return toISO(d);
    d.setDate(d.getDate() + 1);
  }
  return toISO(d);
}

/** 해당 월의 1~15일 정산 입력마감일 (15일이 휴무/일요일이면 이전 마지막 영업일) */
export function firstHalfDeadline(yearMonth: string, hqHolidays: HQHolidaySet): string {
  return lastBusinessDayOnOrBefore(`${yearMonth}-15`, hqHolidays);
}

/** 해당 월의 16~말일 정산 입력마감일 (말일이 휴무/일요일이면 이전 마지막 영업일) */
export function secondHalfDeadline(yearMonth: string, hqHolidays: HQHolidaySet): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0); // m은 1-base, Date는 0-base → 다음달 0일 = 이번달 말일
  return lastBusinessDayOnOrBefore(lastDay, hqHolidays);
}

/** 1~15일 정산서 자동 생성일 (기본 16일, 휴무/일요일이면 다음 영업일) */
export function firstHalfGenerateDate(yearMonth: string, hqHolidays: HQHolidaySet): string {
  return nextBusinessDayOnOrAfter(`${yearMonth}-16`, hqHolidays);
}

/** 16~말일 정산서 자동 생성일 (기본 다음달 1일, 휴무/일요일이면 다음 영업일) */
export function secondHalfGenerateDate(yearMonth: string, hqHolidays: HQHolidaySet): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const next = new Date(y, m, 1); // m은 1-base → 다음달 1일
  return nextBusinessDayOnOrAfter(next, hqHolidays);
}

/** 정산서 자동 생성 가능 여부 */
export type SettlementStatus =
  | "입력중"
  | "입력완료"
  | "정산마감"
  | "자동생성대기"
  | "정산서생성완료"
  | "재생성필요";

export function canAutoGenerate(opts: {
  status: SettlementStatus;
  today: Date | string;
  generateDate: string;
  hasErrors: boolean;
}): boolean {
  if (opts.hasErrors) return false;
  if (opts.status !== "자동생성대기" && opts.status !== "정산마감") return false;
  const today = typeof opts.today === "string" ? opts.today : toISO(opts.today);
  return today >= opts.generateDate;
}