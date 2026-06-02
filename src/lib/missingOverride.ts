// 누락분(missing) 정산 반영월/구간 override 헬퍼.
// 기존 deliveries 스키마(missing_reason 컬럼)를 변경하지 않고,
// reason 문자열 앞에 `[SETTLE:YYYY-MM:H1|H2|FULL]` prefix 를 붙여 저장한다.
//
// - parseMissingReason / buildMissingReason : prefix round-trip
// - hasSettlementOverride / getOverrideMonthHalf : 검사
// - isInEffectivePeriod : 정산 화면 공통 기간 필터 (date 기준 + override 우선)
//
// 절대 statementData.ts 같은 정산 계산 코어를 건드리지 않는다.

export type MissingHalf = "H1" | "H2" | "FULL";

const TAG_RE = /^\s*\[SETTLE:(\d{4}-\d{2}):(H1|H2|FULL)\]\s*([\s\S]*)$/;

export type ParsedMissing = {
  settleMonth: string | null; // "YYYY-MM"
  half: MissingHalf | null;
  reason: string;
};

export function parseMissingReason(raw: unknown): ParsedMissing {
  const s = raw == null ? "" : String(raw);
  const m = TAG_RE.exec(s);
  if (!m) return { settleMonth: null, half: null, reason: s };
  return { settleMonth: m[1], half: (m[2] as MissingHalf), reason: (m[3] || "").trim() };
}

export function buildMissingReason(input: {
  settleMonth?: string | null;
  half?: MissingHalf | null;
  reason?: string | null;
}): string {
  const reason = (input.reason ?? "").trim();
  const month = (input.settleMonth ?? "").trim();
  if (!month) return reason;
  const half: MissingHalf = (input.half ?? "FULL") as MissingHalf;
  return `[SETTLE:${month}:${half}] ${reason}`.trim();
}

type AnyDelivery = {
  date?: string | null;
  missing_reason?: string | null;
  is_missing?: boolean | null;
};

export function getMissingOverride(d: AnyDelivery): ParsedMissing {
  return parseMissingReason(d?.missing_reason);
}

export function hasSettlementOverride(d: AnyDelivery): boolean {
  return !!parseMissingReason(d?.missing_reason).settleMonth;
}

/** 정산상 effective 날짜(YYYY-MM-DD). override 가 있으면 그 월의 1일/16일로 가상화. */
export function getEffectiveSettleDate(d: AnyDelivery): string {
  const o = parseMissingReason(d?.missing_reason);
  if (o.settleMonth) {
    const day = o.half === "H2" ? "16" : "01";
    return `${o.settleMonth}-${day}`;
  }
  return String(d?.date ?? "");
}

export type EffectivePeriod = "h1" | "h2" | "all";

/**
 * (month, period) 정산 묶음에 이 배송이 포함되는지.
 *  - override 있음: override 의 (month, half) 가 매칭되면 포함, 아니면 제외
 *  - override 없음: 원래 date 가 month 에 속하고 day 가 period 에 맞으면 포함
 */
export function isInEffectivePeriod(
  d: AnyDelivery,
  monthYYYYMM: string,
  period: EffectivePeriod,
): boolean {
  const o = parseMissingReason(d?.missing_reason);
  if (o.settleMonth) {
    if (o.settleMonth !== monthYYYYMM) return false;
    if (period === "all" || o.half === "FULL") return true;
    if (period === "h1") return o.half === "H1";
    return o.half === "H2";
  }
  const dt = String(d?.date ?? "");
  if (!dt.startsWith(monthYYYYMM + "-")) return false;
  const day = Number(dt.slice(8, 10));
  if (!day) return false;
  if (period === "all") return true;
  if (period === "h1") return day <= 15;
  return day >= 16;
}

/** PostgREST `or` 절: 해당 월에 override 가 걸린 배송기록을 찾을 때 사용. */
export const settleOverridePrefix = (monthYYYYMM: string) => `[SETTLE:${monthYYYYMM}:`;

/**
 * 정산 화면 전달용: override 가 있는 배송행의 `date` 를 effective 정산 날짜로 치환한
 * 얕은 복사본을 반환. 기존 inPeriod(d.date, period) 로직(day-of-month 검사)에
 * 그대로 흘려보낼 수 있게 해준다. override 가 없으면 원본 그대로 반환.
 */
export function withEffectiveDate<T extends AnyDelivery>(d: T): T {
  if (!hasSettlementOverride(d)) return d;
  return { ...d, date: getEffectiveSettleDate(d) };
}

