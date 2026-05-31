// 정산마감 게이트 — (사용자, 정산월, 기간)별로 "정산마감 처리됨" 상태를 보관.
// 본사휴무 영업일 계산과 결합해 자동생성 가능 시점을 알려준다.

import {
  firstHalfDeadline,
  firstHalfGenerateDate,
  secondHalfDeadline,
  secondHalfGenerateDate,
  type HQHolidaySet,
} from "./businessDay";

export type PeriodKey = "h1" | "h2" | "all";

const key = (uid: string, month: string, period: PeriodKey) =>
  `settle.gate.${uid}.${month}.${period}`;

export function isClosed(uid: string, month: string, period: PeriodKey): boolean {
  try {
    return localStorage.getItem(key(uid, month, period)) === "1";
  } catch {
    return false;
  }
}

export function setClosed(
  uid: string,
  month: string,
  period: PeriodKey,
  closed: boolean,
) {
  try {
    if (closed) localStorage.setItem(key(uid, month, period), "1");
    else localStorage.removeItem(key(uid, month, period));
  } catch {
    /* noop */
  }
}

/** 해당 기간의 입력마감일 / 자동생성일. period="all"이면 후반(말일)을 기준. */
export function gateDates(
  month: string,
  period: PeriodKey,
  hq: HQHolidaySet,
): { deadline: string; generate: string } {
  if (period === "h1") {
    return {
      deadline: firstHalfDeadline(month, hq),
      generate: firstHalfGenerateDate(month, hq),
    };
  }
  return {
    deadline: secondHalfDeadline(month, hq),
    generate: secondHalfGenerateDate(month, hq),
  };
}

export type GateStatus = {
  deadline: string;
  generate: string;
  today: string;
  pastDeadline: boolean;
  pastGenerate: boolean;
  closed: boolean;
  /** 저장 차단 사유 (없으면 빈 문자열) */
  blockedReason: string;
};

const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export function computeGate(
  uid: string | undefined,
  month: string,
  period: PeriodKey,
  hq: HQHolidaySet,
): GateStatus {
  const { deadline, generate } = gateDates(month, period, hq);
  const today = toISO(new Date());
  const pastDeadline = today >= deadline;
  const pastGenerate = today >= generate;
  const closed = uid ? isClosed(uid, month, period) : false;
  let blockedReason = "";
  if (!pastDeadline) {
    blockedReason = `입력마감일(${deadline}) 이전입니다. 기록 입력을 마친 뒤 저장하세요.`;
  } else if (!closed) {
    blockedReason = `정산마감 처리가 아직 안 됐습니다. 아래 "정산마감 처리"를 켜야 저장할 수 있습니다.`;
  }
  return { deadline, generate, today, pastDeadline, pastGenerate, closed, blockedReason };
}