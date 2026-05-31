// 총배송비 공통 계산기 — 업체정산/팀장정산이 항상 동일한 값을 표시하도록
// 두 화면에서 모두 이 함수를 사용해야 한다.
export type DeliveryLike = {
  metro_fee?: number | string | null;
  note_amount?: number | string | null;
  regional_fee?: number | string | null;
};

const n = (v: unknown): number => Number(v) || 0;

/** 단일 배송 행의 (수도권 + 비고 + 지방) 합 */
export const rowDeliveryFee = (r: DeliveryLike): number =>
  n(r.metro_fee) + n(r.note_amount) + n(r.regional_fee);

/** 기간 내 전체 배송 행의 총배송비 합 */
export const totalDeliveryFee = (rows: DeliveryLike[]): number =>
  rows.reduce((s, r) => s + rowDeliveryFee(r), 0);
