// 업체정산 ↔ 팀장정산 "총배송비" 합계가 100% 일치하는지 자동 검증한다.
//
// 같은 rows + virtualIds 입력으로 다음 두 가지 독립 계산식을 돌려 비교한다:
//   A) totalUnifiedDeliveryFee — 양 화면이 사용하는 통합 헬퍼
//   B) 팀장정산식: keepRevisitPrimaryOnly 후 totalLeaderSettlementDeliveryFee
//      (= 적재비 제외 + 가상기사 단독 제외, 재방문은 외부에서 1차만 유지)
// 두 결과가 다르면 어딘가에 데이터/필터링 불일치가 있다는 신호이므로 즉시 경고한다.

import { totalUnifiedDeliveryFee, totalLeaderSettlementDeliveryFee, type DeliveryLike } from "./totalFee";
import { keepRevisitPrimaryOnly } from "./revisitDedup";

export type TotalCrossCheck = {
  ok: boolean;
  unified: number;
  leaderStyle: number;
  diff: number;
  message?: string;
};

type Row = DeliveryLike & {
  id?: string;
  two_person?: boolean | null;
  revisit_group_id?: string | null;
  revisit_visit_no?: number | string | null;
  date?: string | null;
};

export function crossCheckTotalFee(
  rows: Row[],
  virtualIds?: Set<string> | string[] | null,
): TotalCrossCheck {
  const unified = totalUnifiedDeliveryFee(rows, virtualIds);
  const primaryOnly = keepRevisitPrimaryOnly(rows as never[]) as Row[];
  const leaderStyle = totalLeaderSettlementDeliveryFee(primaryOnly, virtualIds);
  const diff = Math.abs(unified - leaderStyle);
  const ok = diff === 0;
  return {
    ok,
    unified,
    leaderStyle,
    diff,
    message: ok
      ? undefined
      : `총배송비 검증 실패: 통합식 ${unified.toLocaleString()} vs 팀장정산식 ${leaderStyle.toLocaleString()} (차이 ${diff.toLocaleString()})`,
  };
}