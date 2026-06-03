// 업체 청구 합계(preVat) ↔ 총배송비(통합식) 자동 비교 검증.
//
// 원칙: 두 값은 VAT 를 제외하면 100% 동일해야 한다.
//   - billed(최종)      = preVat + VAT(업체별 issues_invoice && !vat_included)
//   - 총배송비(통합)    = 적재비/가상기사 단독 제외 + 재방문 1차만, VAT 전 합
//   - preVat 합계       = 위와 동일한 청구 대상 행의 fee 합 (착불상계 적용 후 0 클램프)
//
// preVat 와 총배송비가 다르면:
//   · 재방문 1차 행 선택 규칙 불일치
//   · 청구금액이 음수가 되어 max(0, ...) 으로 잘려나간 업체 존재 (이건 차이 발생 가능)
// 등 구조적 차이가 있다는 신호이므로 대시보드에 경고를 띄운다.

import {
  computeCompanyBilledByCompany,
  totalUnifiedDeliveryFee,
  type BilledCompany,
} from "./totalFee";
import { rowDeliveryFee } from "./totalFee";

export type BilledVsTotalFeeResult = {
  ok: boolean;
  totalFee: number;        // 통합식 총배송비 (VAT 전)
  preVatSum: number;       // 모든 업체 청구금액 합 (VAT 전)
  vatSum: number;          // 모든 업체 VAT 합
  billedSum: number;       // preVatSum + vatSum (실제 청구 합계)
  diff: number;            // preVatSum - totalFee  (VAT 외 잔차; 0 이어야 정상)
  message?: string;
  perCompany: BilledCompany[];
};

export function checkBilledVsTotalFee(
  deliveries: Parameters<typeof computeCompanyBilledByCompany>[0],
  companies: Parameters<typeof computeCompanyBilledByCompany>[1],
  virtualIds?: Set<string> | string[] | null,
): BilledVsTotalFeeResult {
  // 정책(2026-06): 착불 행은 업체 청구 대상에서 제외되므로
  // 비교 기준의 총배송비도 동일하게 착불 행을 제외한 값으로 산출한다.
  const billableDeliveries = deliveries.filter((d) => !(Number(d.cod_amount) > 0));
  const totalFee = totalUnifiedDeliveryFee(billableDeliveries, virtualIds);
  const map = computeCompanyBilledByCompany(deliveries, companies, virtualIds);

  let preVatSum = 0;
  let vatSum = 0;
  let billedSum = 0;
  const perCompany: BilledCompany[] = [];
  for (const v of map.values()) {
    preVatSum += v.preVat;
    vatSum += v.vat;
    billedSum += v.billed;
    perCompany.push(v);
  }

  const diff = Math.round(preVatSum - totalFee);
  const ok = Math.abs(diff) < 1;
  return {
    ok,
    totalFee,
    preVatSum,
    vatSum,
    billedSum,
    diff,
    perCompany,
    message: ok
      ? undefined
      : `업체 청구 합계(VAT 전) ${preVatSum.toLocaleString()}원 ≠ 총배송비 ${totalFee.toLocaleString()}원 (차이 ${diff.toLocaleString()}원). VAT 외 잔차가 존재합니다.`,
  };
}
