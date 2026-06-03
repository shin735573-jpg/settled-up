import { isLeaderSettlementExcludedItem } from "./itemRules";
import { isVirtualSettlementRow } from "./itemRules";

// 총배송비 공통 계산기 — 화면별 합산 기준을 한 곳에서 관리한다.
export type DeliveryLike = {
  item?: string | null;
  virtual_leader_id?: string | null;
  virtual_leader_name?: string | null;
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

/**
 * 팀장정산 배송비 합 — 적재비 같은 별도 매출 품목은 제외.
 * 가상기사 단독 행은 제외하되, 2인배송 행은 가상기사가 파트너로 들어있어도 실제 배송이므로 포함.
 * (통합식 totalUnifiedDeliveryFee 및 buildCompanyStatements/buildLeaderStatements 와 동일 규칙)
 */
export const totalLeaderSettlementDeliveryFee = (
  rows: (DeliveryLike & { two_person?: boolean | null })[],
  virtualIds?: Set<string> | string[] | null,
): number =>
  rows.reduce((s, r) => {
    if (isLeaderSettlementExcludedItem(r.item)) return s;
    if (!r.two_person && isVirtualSettlementRow(r, virtualIds)) return s;
    return s + rowDeliveryFee(r);
  }, 0);

/**
 * 두 화면(업체정산/팀장정산)의 "총배송비" 카드가 100% 동일하게 나오도록 통일된 합산기.
 *  - 적재비 등 정산제외 품목 제외
 *  - 가상기사 단독 행 제외 (2인배송 행은 포함)
 *  - 재방문 그룹은 1차 행만 합산 (2차+ 제외)
 *
 * 호출측은 화면별로 가공한 rows 가 아니라, 동일한 원본 rows 를 그대로 넘기면 된다.
 */
type UnifiedRow = DeliveryLike & {
  two_person?: boolean | null;
  revisit_group_id?: string | null;
  date?: string | null;
  revisit_visit_no?: number | string | null;
};

export const totalUnifiedDeliveryFee = (
  rows: UnifiedRow[],
  virtualIds?: Set<string> | string[] | null,
): number => {
  // 재방문 그룹의 1차 행 선택 — keepRevisitPrimaryOnly 와 동일한 규칙:
  //   1) visit_no 가 더 작은 행 우선
  //   2) 동률이면 날짜가 더 빠른 행 우선
  // (과거에는 날짜만 보고 골라 visit_no=1 행이 더 늦은 날짜인 경우 두 식이 어긋났음)
  const primary = new Map<string, { visitNo: number; date: string; rowRef: UnifiedRow }>();
  for (const r of rows) {
    const gid = r.revisit_group_id;
    if (!gid) continue;
    const vn = Number(r.revisit_visit_no ?? 1);
    const dt = String(r.date || "");
    const cur = primary.get(gid);
    const better = !cur || vn < cur.visitNo || (vn === cur.visitNo && dt && dt < cur.date);
    if (better) primary.set(gid, { visitNo: vn, date: dt, rowRef: r });
  }
  let sum = 0;
  for (const r of rows) {
    if (isLeaderSettlementExcludedItem(r.item)) continue;
    if (!r.two_person && isVirtualSettlementRow(r, virtualIds)) continue;
    const gid = r.revisit_group_id;
    if (gid) {
      const first = primary.get(gid);
      if (!first || first.rowRef !== r) continue; // 1차 행이 아니면 제외
    }
    sum += rowDeliveryFee(r);
  }
  return sum;
};

/**
 * 실제 업체에 청구된 금액(업체별) — 정산용 내부 계산값과 분리해서 표시할 때 사용.
 *
 * 계산 기준 (statementData.buildCompanyStatements 와 동일한 원칙):
 *  - 가상기사 단독 행 제외 (단 2인배송 행은 포함)
 *  - 재방문 그룹은 1차 행만 청구에 포함 (2차+ 제외)
 *  - 미수금 = (배송비 합) − (paid 행 합)
 *  - 청구 = max(0, 미수금 − 착불 상계)
 *  - 부가세 = issues_invoice && !vat_included 이면 청구금액의 10%
 *  - 최종 청구금액 = issues_invoice ? 청구 + VAT : 청구
 *
 * deliveries 는 이미 기간 필터된 상태라고 가정한다 (LeaderSettlement 의 `rows`).
 */
export type BilledCompany = {
  id: string;
  name: string;
  billed: number; // 실제 청구금액 (VAT 포함)
  preVat: number; // VAT 전 청구금액
  vat: number;
};

type BillableCompany = {
  id: string;
  name: string;
  issues_invoice?: boolean | null;
  vat_included?: boolean | null;
};

type BillableDelivery = DeliveryLike & {
  company_id?: string | null;
  company_name?: string | null;
  cod_amount?: number | string | null;
  paid?: boolean | null;
  two_person?: boolean | null;
  revisit_group_id?: string | null;
  revisit_visit_no?: number | string | null;
  date?: string | null;
};

export function computeCompanyBilledByCompany(
  deliveries: BillableDelivery[],
  companies: BillableCompany[],
  virtualIds?: Set<string> | string[] | null,
): Map<string, BilledCompany> {
  const out = new Map<string, BilledCompany>();
  const byId = new Map(companies.map((c) => [c.id, c]));
  const byName = new Map(companies.map((c) => [String(c.name || "").trim(), c]));

  // 회사별 그룹화 + 재방문 1차 행만 포함
  type Grp = { c: BillableCompany; rows: BillableDelivery[] };
  const groups = new Map<string, Grp>();

  for (const d of deliveries) {
    // 가상기사 단독 행은 업체 청구에서 제외 (단, 2인배송은 포함)
    if (!d.two_person && isVirtualSettlementRow(d, virtualIds)) continue;
    const c = (d.company_id && byId.get(d.company_id)) || byName.get(String(d.company_name || "").trim());
    if (!c) continue;
    let g = groups.get(c.id);
    if (!g) { g = { c, rows: [] }; groups.set(c.id, g); }
    g.rows.push(d);
  }

  for (const [, g] of groups) {
    // 재방문 그룹 1차만 포함 (가장 빠른 날짜의 행)
    const earliest = new Map<string, string>();
    for (const d of g.rows) {
      const gid = d.revisit_group_id;
      if (!gid) continue;
      const cur = earliest.get(gid);
      const dt = String(d.date || "");
      if (!cur || (dt && dt < cur)) earliest.set(gid, dt);
    }
    const billableRows = g.rows.filter((d) => {
      const gid = d.revisit_group_id;
      if (!gid) return true;
      const first = earliest.get(gid);
      // 동일 그룹 내에서 가장 빠른 날짜의 행만 청구에 포함
      return first && String(d.date || "") === first;
    });
    const feeSum = billableRows.reduce((s, r) => s + rowDeliveryFee(r), 0);
    const paidSum = billableRows.filter((r) => r.paid).reduce((s, r) => s + rowDeliveryFee(r), 0);
    const unpaid = feeSum - paidSum;
    // 정책(2026-06): 입력란 착불은 보고용 표시 → 업체 청구액에서 상계하지 않는다.
    const claim = Math.max(0, unpaid);
    const issues = !!g.c.issues_invoice;
    const vat = issues && !g.c.vat_included ? Math.round(claim * 0.1) : 0;
    const billed = issues ? claim + vat : claim;
    out.set(g.c.id, {
      id: g.c.id,
      name: g.c.name,
      billed,
      preVat: claim,
      vat,
    });
  }
  return out;
}
