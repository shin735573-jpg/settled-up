// 업체정산 ↔ 팀장정산 "총배송비" 합계가 100% 일치하는지 자동 검증한다.
//
// 같은 rows + virtualIds 입력으로 다음 두 가지 독립 계산식을 돌려 비교한다:
//   A) totalUnifiedDeliveryFee — 양 화면이 사용하는 통합 헬퍼
//   B) 팀장정산식: keepRevisitPrimaryOnly 후 totalLeaderSettlementDeliveryFee
//      (= 적재비 제외 + 가상기사 단독 제외, 재방문은 외부에서 1차만 유지)
// 두 결과가 다르면 어딘가에 데이터/필터링 불일치가 있다는 신호이므로 즉시 경고한다.

import { totalUnifiedDeliveryFee, totalLeaderSettlementDeliveryFee, type DeliveryLike } from "./totalFee";
import { keepRevisitPrimaryOnly } from "./revisitDedup";
import { isLeaderSettlementExcludedItem, isVirtualSettlementRow } from "./itemRules";
import { rowDeliveryFee } from "./totalFee";

export type CategoryBreakdown = {
  /** 카테고리명 */
  label: string;
  /** 행 수 */
  count: number;
  /** 해당 카테고리 행들의 배송비 합 */
  amount: number;
  /** 통합식(A) 에서 포함되었는지 */
  includedInUnified: boolean;
  /** 팀장정산식(B) 에서 포함되었는지 */
  includedInLeaderStyle: boolean;
  /** 양식 차이로 인한 합계 영향 (A − B) */
  contribution: number;
};

export type TotalCrossCheck = {
  ok: boolean;
  unified: number;
  leaderStyle: number;
  diff: number;
  message?: string;
  /** 차이 항목별 상세 — 어느 계산식이 어떤 행을 더/덜 잡았는지 */
  categories: CategoryBreakdown[];
};

type Row = DeliveryLike & {
  id?: string;
  two_person?: boolean | null;
  revisit_group_id?: string | null;
  revisit_visit_no?: number | string | null;
  date?: string | null;
};

const n = (v: unknown) => Number(v) || 0;

export function crossCheckTotalFee(
  rows: Row[],
  virtualIds?: Set<string> | string[] | null,
): TotalCrossCheck {
  const unified = totalUnifiedDeliveryFee(rows, virtualIds);
  const primaryOnly = keepRevisitPrimaryOnly(rows as never[]) as Row[];
  const leaderStyle = totalLeaderSettlementDeliveryFee(primaryOnly, virtualIds);
  const diff = Math.abs(unified - leaderStyle);
  const ok = diff === 0;

  // ── 카테고리 분류 ──
  // 1) 적재비 등 정산제외 품목 — 양쪽 모두 제외 (포함되면 두 식 모두 영향)
  // 2) 가상기사 단독 행 (2인배송 아님) — 양쪽 모두 제외
  // 3) 재방문 그룹 2차+ 행 — 통합식(A)은 외부 가공 없이 그대로 받음에도 내부에서 1차만 합산,
  //    팀장정산식(B)은 keepRevisitPrimaryOnly 로 사전 필터 → 양쪽 모두 제외
  // 4) 통합식만/팀장식만 포함되는 행이 있으면 그 행의 배송비가 곧 차이의 원인이다.
  const primaryIds = new Set(primaryOnly.map((r) => r.id).filter(Boolean) as string[]);

  let excludedItemCount = 0, excludedItemAmt = 0;
  let virtualSoloCount = 0, virtualSoloAmt = 0;
  let revisitSecondaryCount = 0, revisitSecondaryAmt = 0;
  let onlyUnifiedCount = 0, onlyUnifiedAmt = 0;
  let onlyLeaderCount = 0, onlyLeaderAmt = 0;

  for (const r of rows) {
    const fee = rowDeliveryFee(r);
    const isExcludedItem = isLeaderSettlementExcludedItem(r.item);
    const isVirtualSolo = !r.two_person && isVirtualSettlementRow(r, virtualIds);
    const isRevisitSecondary = !!r.revisit_group_id && !primaryIds.has(String(r.id));

    if (isExcludedItem) { excludedItemCount++; excludedItemAmt += fee; }
    if (isVirtualSolo)  { virtualSoloCount++;  virtualSoloAmt  += fee; }
    if (isRevisitSecondary) { revisitSecondaryCount++; revisitSecondaryAmt += fee; }

    // 통합식(A) 행 포함 여부 — totalUnifiedDeliveryFee 규칙 재현
    //   재방문 그룹은 1차(=primaryIds 안에 있음) 만 포함
    const inA = !isExcludedItem && !isVirtualSolo &&
      (!r.revisit_group_id || primaryIds.has(String(r.id)));
    // 팀장정산식(B) 행 포함 여부 — primaryOnly 에서 적재비/가상기사 제외
    const inB = !isExcludedItem && !isVirtualSolo && primaryIds.has(String(r.id));

    if (inA && !inB) { onlyUnifiedCount++; onlyUnifiedAmt += fee; }
    if (inB && !inA) { onlyLeaderCount++;  onlyLeaderAmt  += fee; }
  }

  const categories: CategoryBreakdown[] = [
    {
      label: "적재비 등 정산제외 품목",
      count: excludedItemCount,
      amount: excludedItemAmt,
      includedInUnified: false,
      includedInLeaderStyle: false,
      contribution: 0, // 양쪽 모두 제외 → 차이 없음
    },
    {
      label: "가상기사 단독 행 (2인배송 제외)",
      count: virtualSoloCount,
      amount: virtualSoloAmt,
      includedInUnified: false,
      includedInLeaderStyle: false,
      contribution: 0,
    },
    {
      label: "재방문 그룹 2차+ 행",
      count: revisitSecondaryCount,
      amount: revisitSecondaryAmt,
      includedInUnified: false,
      includedInLeaderStyle: false,
      contribution: 0,
    },
    {
      label: "통합식만 포함 (팀장정산식이 누락)",
      count: onlyUnifiedCount,
      amount: onlyUnifiedAmt,
      includedInUnified: true,
      includedInLeaderStyle: false,
      contribution: onlyUnifiedAmt,
    },
    {
      label: "팀장정산식만 포함 (통합식이 누락)",
      count: onlyLeaderCount,
      amount: onlyLeaderAmt,
      includedInUnified: false,
      includedInLeaderStyle: true,
      contribution: -onlyLeaderAmt,
    },
  ];

  return {
    ok,
    unified,
    leaderStyle,
    diff,
    categories,
    message: ok
      ? undefined
      : `총배송비 검증 실패: 통합식 ${unified.toLocaleString()} vs 팀장정산식 ${leaderStyle.toLocaleString()} (차이 ${diff.toLocaleString()})`,
  };
}