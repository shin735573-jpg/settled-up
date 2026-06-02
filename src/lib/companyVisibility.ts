// 업체정산 화면의 업체 표시 필터 로직.
// 컴포넌트에서 분리하여 단위 테스트가 가능하도록 추출.
import { matchesCompany, type CompanyLike, type DeliveryLike } from "./companyMatch";

export type SettlementPeriod = "all" | "first" | "second" | "month";

export interface VisibilityCompany extends CompanyLike {
  settlement_cycle?: string | null;
}

/**
 * 정산주기에 따른 업체 표시 필터.
 * - 월전체/전체: 모든 업체 표시
 * - 1~15일 / 16~말일(보름):
 *    · 보름 주기 업체는 항상 표시
 *    · 월 주기 업체라도 해당 기간에 배송행 또는 이월 착불행이 있으면 표시
 */
export function filterVisibleCompanies<C extends VisibilityCompany>(
  companies: C[],
  period: SettlementPeriod,
  periodRows: DeliveryLike[],
  carryRows: DeliveryLike[],
): C[] {
  return companies.filter((c) => {
    const cyc = c.settlement_cycle || "biweekly";
    if (period === "all" || period === "month") return true;
    if (cyc === "biweekly") return true;
    const hasPeriodRows = periodRows.some((r) => matchesCompany(r, c));
    const hasCarryRows = carryRows.some((r) => matchesCompany(r, c));
    return hasPeriodRows || hasCarryRows;
  });
}
