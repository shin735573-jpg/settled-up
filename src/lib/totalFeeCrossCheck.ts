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

export type CategoryRow = {
  id?: string;
  date?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  item?: string | null;
  leader1_name?: string | null;
  fee: number;
};

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
  /** 이 카테고리에 속하는 실제 행 목록 (클릭 → 상세 다이얼로그용) */
  rows: CategoryRow[];
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
  company_name?: string | null;
  customer_name?: string | null;
  leader1_name?: string | null;
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

  const excludedItemRows: CategoryRow[] = [];
  const virtualSoloRows: CategoryRow[] = [];
  const revisitSecondaryRows: CategoryRow[] = [];
  const onlyUnifiedRows: CategoryRow[] = [];
  const onlyLeaderRows: CategoryRow[] = [];

  const toCat = (r: Row, fee: number): CategoryRow => ({
    id: r.id,
    date: r.date ?? null,
    company_name: r.company_name ?? null,
    customer_name: r.customer_name ?? null,
    item: r.item ?? null,
    leader1_name: r.leader1_name ?? null,
    fee,
  });

  for (const r of rows) {
    const fee = rowDeliveryFee(r);
    const isExcludedItem = isLeaderSettlementExcludedItem(r.item);
    const isVirtualSolo = !r.two_person && isVirtualSettlementRow(r, virtualIds);
    const isRevisitSecondary = !!r.revisit_group_id && !primaryIds.has(String(r.id));

    if (isExcludedItem)     excludedItemRows.push(toCat(r, fee));
    if (isVirtualSolo)      virtualSoloRows.push(toCat(r, fee));
    if (isRevisitSecondary) revisitSecondaryRows.push(toCat(r, fee));

    // 통합식(A) 행 포함 여부 — totalUnifiedDeliveryFee 규칙 재현
    //   재방문 그룹은 1차(=primaryIds 안에 있음) 만 포함
    const inA = !isExcludedItem && !isVirtualSolo &&
      (!r.revisit_group_id || primaryIds.has(String(r.id)));
    // 팀장정산식(B) 행 포함 여부 — primaryOnly 에서 적재비/가상기사 제외
    const inB = !isExcludedItem && !isVirtualSolo && primaryIds.has(String(r.id));

    if (inA && !inB) onlyUnifiedRows.push(toCat(r, fee));
    if (inB && !inA) onlyLeaderRows.push(toCat(r, fee));
  }

  const sumFee = (xs: CategoryRow[]) => xs.reduce((s, x) => s + x.fee, 0);

  const categories: CategoryBreakdown[] = [
    {
      label: "적재비 등 정산제외 품목",
      count: excludedItemRows.length,
      amount: sumFee(excludedItemRows),
      includedInUnified: false,
      includedInLeaderStyle: false,
      contribution: 0, // 양쪽 모두 제외 → 차이 없음
      rows: excludedItemRows,
    },
    {
      label: "가상기사 단독 행 (2인배송 제외)",
      count: virtualSoloRows.length,
      amount: sumFee(virtualSoloRows),
      includedInUnified: false,
      includedInLeaderStyle: false,
      contribution: 0,
      rows: virtualSoloRows,
    },
    {
      label: "재방문 그룹 2차+ 행",
      count: revisitSecondaryRows.length,
      amount: sumFee(revisitSecondaryRows),
      includedInUnified: false,
      includedInLeaderStyle: false,
      contribution: 0,
      rows: revisitSecondaryRows,
    },
    {
      label: "통합식만 포함 (팀장정산식이 누락)",
      count: onlyUnifiedRows.length,
      amount: sumFee(onlyUnifiedRows),
      includedInUnified: true,
      includedInLeaderStyle: false,
      contribution: sumFee(onlyUnifiedRows),
      rows: onlyUnifiedRows,
    },
    {
      label: "팀장정산식만 포함 (통합식이 누락)",
      count: onlyLeaderRows.length,
      amount: sumFee(onlyLeaderRows),
      includedInUnified: false,
      includedInLeaderStyle: true,
      contribution: -sumFee(onlyLeaderRows),
      rows: onlyLeaderRows,
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