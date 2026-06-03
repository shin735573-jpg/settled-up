import { isLeaderSettlementExcludedItem, isVirtualSettlementRow } from "./itemRules";
import { rowDeliveryFee } from "./totalFee";

/**
 * "총배송비(정산용)" vs "업체청구금액(실제)" 차이의 100% 원인 분해.
 *
 * 두 값은 본래 같은 행 집합에서 계산되지만, 다음 규칙 차이 때문에 불일치가 생긴다:
 *   1) paid_offset      — 이미 결제된 행 (총배송비엔 포함, 업체청구엔 차감)
 *   2) cod_used         — 착불 상계분 (총배송비엔 영향 없음, 업체청구에선 차감)
 *   3) vat_added        — 세금계산서 발행 업체의 부가세 10% (업체청구에만 가산 → 차이를 줄임)
 *   4) item_excluded    — 적재비 등 정산제외 품목 (업체청구엔 포함, 총배송비엔 제외)
 *   5) revisit_tie      — 재방문 1차가 같은 날짜에 여러 건일 때 (총배송비는 최초 1개만, 업체청구는 동일일자 전부)
 *   6) unmatched        — 어느 업체에도 매칭되지 않은 행 (총배송비엔 포함, 업체청구엔 미포함)
 *
 * 합산식:
 *   T - B = paid_offset + cod_used - vat_added - item_excluded - revisit_tie + unmatched
 * 모든 카테고리는 동일 계산기로 추출하므로 100% 재현 가능하다.
 */

export type TVBRowRef = {
  id?: string | null;
  date?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  item?: string | null;
  fee: number;
  note?: string;
};

export type TVBComponent = {
  key: "paid_offset" | "cod_used" | "vat_added" | "item_excluded" | "revisit_tie" | "unmatched";
  label: string;
  sign: 1 | -1; // +1 = T-B 를 증가시키는 방향, -1 = 감소시키는 방향
  amount: number; // 절대값 합
  signedAmount: number; // sign * amount (T-B 분해에서의 기여도)
  rows: TVBRowRef[];
  hint: string;
};

export type TVBPerCompany = {
  companyId: string;
  companyName: string;
  feeSum: number;
  paid: number;
  codUsed: number;
  codExcess: number;
  vat: number;
  itemExcluded: number;
  revisitTie: number;
  billed: number;
  tContribution: number;
  diff: number; // tContribution - billed
};

export type TotalVsBilledCheck = {
  ok: boolean;
  totalFee: number;
  billedTotal: number;
  diff: number; // totalFee - billedTotal
  reconstructed: number; // 분해 합 (검산용; diff 와 동일해야 함)
  components: TVBComponent[];
  perCompany: TVBPerCompany[];
};

type Row = {
  id?: string | null;
  date?: string | null;
  item?: string | null;
  metro_fee?: number | string | null;
  note_amount?: number | string | null;
  regional_fee?: number | string | null;
  cod_amount?: number | string | null;
  paid?: boolean | null;
  two_person?: boolean | null;
  virtual_leader_id?: string | null;
  virtual_leader_name?: string | null;
  revisit_group_id?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
};

type Company = {
  id: string;
  name: string;
  issues_invoice?: boolean | null;
  vat_included?: boolean | null;
};

const n = (v: unknown): number => Number(v) || 0;
const ref = (r: Row, fee: number, note?: string): TVBRowRef => ({
  id: r.id ?? null,
  date: r.date ?? null,
  company_name: r.company_name ?? null,
  customer_name: r.customer_name ?? null,
  item: r.item ?? null,
  fee,
  note,
});

export function crossCheckTotalVsBilled(
  rows: Row[],
  companies: Company[],
  virtualIds?: Set<string> | string[] | null,
): TotalVsBilledCheck {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const byName = new Map(
    companies.map((c) => [String(c.name || "").trim(), c]),
  );

  // ---- 회사별 그룹: T/B 양쪽에서 살아남을 후보 행만 모은다 ----
  type Grp = { c: Company; rows: Row[] };
  const groups = new Map<string, Grp>();
  const unmatchedRows: Row[] = [];

  // 가상기사 단독 행은 두 합계 모두에서 제외 (양쪽 모두 동일 규칙)
  const aliveRows: Row[] = [];
  for (const r of rows) {
    if (!r.two_person && isVirtualSettlementRow(r, virtualIds)) continue;
    aliveRows.push(r);
  }

  for (const r of aliveRows) {
    const c =
      (r.company_id && byId.get(r.company_id)) ||
      byName.get(String(r.company_name || "").trim());
    if (!c) {
      unmatchedRows.push(r);
      continue;
    }
    let g = groups.get(c.id);
    if (!g) {
      g = { c, rows: [] };
      groups.set(c.id, g);
    }
    g.rows.push(r);
  }

  // ---- 카테고리별 누적 ----
  const cat = {
    paid_offset: { amt: 0, rows: [] as TVBRowRef[] },
    cod_used: { amt: 0, rows: [] as TVBRowRef[] },
    vat_added: { amt: 0, rows: [] as TVBRowRef[] },
    item_excluded: { amt: 0, rows: [] as TVBRowRef[] },
    revisit_tie: { amt: 0, rows: [] as TVBRowRef[] },
    unmatched: { amt: 0, rows: [] as TVBRowRef[] },
  };

  const perCompany: TVBPerCompany[] = [];
  let totalFee = 0;
  let billedTotal = 0;

  for (const [, g] of groups) {
    // 재방문 그룹별 최저 날짜
    const earliest = new Map<string, string>();
    for (const d of g.rows) {
      const gid = d.revisit_group_id;
      if (!gid) continue;
      const dt = String(d.date || "");
      const cur = earliest.get(gid);
      if (!cur || (dt && dt < cur)) earliest.set(gid, dt);
    }

    // B 측 청구 후보: 재방문 1차(가장 빠른 날짜)에 해당하는 모든 행
    const billableRows: Row[] = [];
    for (const d of g.rows) {
      const gid = d.revisit_group_id;
      if (gid) {
        const first = earliest.get(gid);
        if (!first || String(d.date || "") !== first) continue; // 2차+ 제외
      }
      billableRows.push(d);
    }

    // T 측은 같은 후보 중 (a) 정산제외 품목 제외 (b) 동일 최저일자 중 첫 1행만
    const tieSeen = new Set<string>();
    let feeSum = 0,
      paidSum = 0,
      codSum = 0,
      itemExclFee = 0,
      tieExtraFee = 0,
      tContribution = 0;

    for (const d of billableRows) {
      const fee = rowDeliveryFee(d);
      feeSum += fee;
      if (d.paid) paidSum += fee;
      codSum += n(d.cod_amount);

      const isExcl = isLeaderSettlementExcludedItem(d.item);
      const gid = d.revisit_group_id;
      const isTieExtra = (() => {
        if (!gid) return false;
        if (tieSeen.has(gid)) return true;
        tieSeen.add(gid);
        return false;
      })();

      if (isExcl) {
        itemExclFee += fee;
        cat.item_excluded.amt += fee;
        cat.item_excluded.rows.push(ref(d, fee, "정산제외 품목(적재비 등)"));
      } else if (isTieExtra) {
        tieExtraFee += fee;
        cat.revisit_tie.amt += fee;
        cat.revisit_tie.rows.push(ref(d, fee, "재방문 1차 동일일자 중복"));
      } else {
        tContribution += fee;
      }

      if (d.paid) {
        cat.paid_offset.rows.push(ref(d, fee, "이미 결제 → 업체청구에서 차감"));
      }
    }
    cat.paid_offset.amt += paidSum;

    const unpaid = feeSum - paidSum;
    // 정책(2026-06): 착불은 보고용 → 업체청구에서 상계하지 않음.
    const codUsed = 0;
    const codExcess = 0;
    const claim = Math.max(0, unpaid);
    const issues = !!g.c.issues_invoice;
    const vat = issues && !g.c.vat_included ? Math.round(claim * 0.1) : 0;
    const billed = issues ? claim + vat : claim;
    if (vat > 0) {
      cat.vat_added.amt += vat;
      cat.vat_added.rows.push({
        id: null,
        date: null,
        company_name: g.c.name,
        customer_name: null,
        item: null,
        fee: vat,
        note: "세금계산서 발행 → VAT 10% 가산",
      });
    }

    totalFee += tContribution;
    billedTotal += billed;
    perCompany.push({
      companyId: g.c.id,
      companyName: g.c.name,
      feeSum,
      paid: paidSum,
      codUsed,
      codExcess,
      vat,
      itemExcluded: itemExclFee,
      revisitTie: tieExtraFee,
      billed,
      tContribution,
      diff: tContribution - billed,
    });
  }

  // 업체 미매칭 행: T 에만 포함 (정산제외 품목/재방문 2차 제외 조건은 동일 적용)
  for (const r of unmatchedRows) {
    if (isLeaderSettlementExcludedItem(r.item)) continue;
    // 미매칭 행은 그룹 정보를 구성할 수 없으므로 보수적으로 그대로 합산 (T 계산기와 일관성 유지)
    const fee = rowDeliveryFee(r);
    totalFee += fee;
    cat.unmatched.amt += fee;
    cat.unmatched.rows.push(ref(r, fee, "업체 미매칭 — 업체청구 집계에 포함되지 않음"));
  }

  perCompany.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const components: TVBComponent[] = [
    {
      key: "paid_offset",
      label: "결제완료 상계",
      sign: +1,
      amount: cat.paid_offset.amt,
      signedAmount: +cat.paid_offset.amt,
      rows: cat.paid_offset.rows,
      hint: "이미 결제된 행은 총배송비엔 포함되지만 업체청구에선 빠진다.",
    },
    {
      key: "cod_used",
      label: "착불 (보고용, 청구 미반영)",
      sign: +1,
      amount: cat.cod_used.amt,
      signedAmount: +cat.cod_used.amt,
      rows: cat.cod_used.rows,
      hint: "착불 입력값은 표시·보고용 — 업체청구 금액 산정에 영향을 주지 않는다.",
    },
    {
      key: "vat_added",
      label: "부가세 가산",
      sign: -1,
      amount: cat.vat_added.amt,
      signedAmount: -cat.vat_added.amt,
      rows: cat.vat_added.rows,
      hint: "세금계산서 발행 업체는 청구액에 VAT 10% 가산 → 차이를 줄인다.",
    },
    {
      key: "item_excluded",
      label: "정산제외 품목(적재비 등)",
      sign: -1,
      amount: cat.item_excluded.amt,
      signedAmount: -cat.item_excluded.amt,
      rows: cat.item_excluded.rows,
      hint: "적재비 등 정산제외 품목은 업체청구엔 포함되지만 총배송비에선 빠진다.",
    },
    {
      key: "revisit_tie",
      label: "재방문 1차 동일일자 중복",
      sign: -1,
      amount: cat.revisit_tie.amt,
      signedAmount: -cat.revisit_tie.amt,
      rows: cat.revisit_tie.rows,
      hint: "재방문 그룹의 최저 날짜에 행이 2건 이상이면 총배송비는 1건만, 업체청구는 전부 포함된다.",
    },
    {
      key: "unmatched",
      label: "업체 미매칭",
      sign: +1,
      amount: cat.unmatched.amt,
      signedAmount: +cat.unmatched.amt,
      rows: cat.unmatched.rows,
      hint: "업체와 연결되지 않은 행은 총배송비엔 합산되지만 업체청구엔 들어가지 않는다.",
    },
  ];

  const reconstructed = components.reduce((s, c) => s + c.signedAmount, 0);
  const diff = totalFee - billedTotal;

  return {
    ok: diff === 0,
    totalFee,
    billedTotal,
    diff,
    reconstructed,
    components,
    perCompany,
  };
}