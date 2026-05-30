// 신동석↔강형주 교차검증 설정. 단일 사용자/단일 브라우저 기준이므로 localStorage 저장.
// 변경 시 'sds-ghj-crosscheck:changed' CustomEvent를 디스패치해 화면이 즉시 갱신되도록 한다.

export type CrossCheckItem = "count" | "total" | "cod" | "fees";
export type CrossCheckBasis = "redistributed" | "raw";
export type CrossCheckExclude = "exclude_excluded" | "include_all";

export type CrossCheckConfig = {
  items: Record<CrossCheckItem, boolean>;
  basis: CrossCheckBasis;          // 재분배 포함(기본) | 원본 배분만
  exclude: CrossCheckExclude;      // 정산제외 팀장 제외(기본) | 모두 포함
  tolerance: number;               // 허용 오차 (원 단위)
};

const KEY = "sds_ghj_crosscheck_v1";
const EVENT = "sds-ghj-crosscheck:changed";

export const DEFAULT_CROSSCHECK: CrossCheckConfig = {
  items: { count: true, total: true, cod: true, fees: true },
  basis: "redistributed",
  exclude: "exclude_excluded",
  tolerance: 0.5,
};

export const CROSSCHECK_ITEM_LABELS: Record<CrossCheckItem, string> = {
  count: "배송건수",
  total: "실지급배송비",
  cod: "착불합계",
  fees: "수수료합계",
};

export function loadCrossCheckConfig(): CrossCheckConfig {
  if (typeof window === "undefined") return DEFAULT_CROSSCHECK;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CROSSCHECK;
    const parsed = JSON.parse(raw);
    return {
      items: { ...DEFAULT_CROSSCHECK.items, ...(parsed.items || {}) },
      basis: parsed.basis === "raw" ? "raw" : "redistributed",
      exclude: parsed.exclude === "include_all" ? "include_all" : "exclude_excluded",
      tolerance: typeof parsed.tolerance === "number" ? parsed.tolerance : DEFAULT_CROSSCHECK.tolerance,
    };
  } catch {
    return DEFAULT_CROSSCHECK;
  }
}

export function saveCrossCheckConfig(cfg: CrossCheckConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeCrossCheckConfig(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}