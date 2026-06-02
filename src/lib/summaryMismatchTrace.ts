import { keepRevisitPrimaryOnly } from "./revisitDedup";

/**
 * 한눈요약(Summary) 페이지에서 "업체 총금액" 과 "팀장 배송비 합" 이 다른 이유를
 * 100% 원인 분해해 보여주기 위한 유틸.
 *
 * 두 값은 본래 같은 validRows 에서 출발하지만, 다음 규칙 차이로 갈라진다:
 *  - 업체 합 = visible(active) 업체에 매칭되는 "재방문 1차" 행의 (수도권+비고+지방)
 *  - 팀장 합 = 모든 validRows 의 집계가능 팀장 share 합 (재방문 2차도 포함)
 *
 * 그래서 leader - company 차이는 아래 3개 카테고리로 100% 분해된다:
 *   A) revisit_extra        : 재방문 2차+ 행의 leader share 합 (+leader)
 *   B) unmatched_company    : 활성 업체와 매칭되지 않는 1차 행의 leader share 합 (+leader)
 *   C) noncountable_share   : 1차+매칭된 행 중 leader share 가 행 금액보다 적은 부분
 *                              (거부/정산제외/가상기사 자리로 빠진 몫) (-leader → +company)
 *
 * 검산식: leaderTotal - companyTotal = A + B - C
 */

export type SMTRowRef = {
  id?: string | null;
  date?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  item?: string | null;
  amount: number; // 해당 카테고리가 차이에 기여한 금액
  note?: string;
};

export type SMTComponent = {
  key: "revisit_extra" | "unmatched_company" | "noncountable_share";
  label: string;
  sign: 1 | -1; // L-C 분해에서의 기여 부호
  amount: number; // 절대값 합
  signedAmount: number;
  rows: SMTRowRef[];
  hint: string;
};

export type SummaryMismatchTrace = {
  ok: boolean;
  companyTotal: number;
  leaderTotal: number;
  diff: number; // leader - company
  reconstructed: number;
  components: SMTComponent[];
};

type AnyRow = {
  id?: string | null;
  date?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  item?: string | null;
  metro_fee?: number | string | null;
  note_amount?: number | string | null;
  regional_fee?: number | string | null;
  revisit_group_id?: string | null;
  revisit_visit_no?: number | null;
};

type Share = { metro: number; note_amount: number; regional: number };
type Allocation = { row: AnyRow; shares: Share[]; hasValid: boolean };

type CompanyLike = { id: string; name: string; active: boolean };

const n = (v: unknown): number => Number(v) || 0;
const rowFee = (r: AnyRow): number =>
  n(r.metro_fee) + n(r.note_amount) + n(r.regional_fee);
const shareSum = (ss: Share[]): number =>
  ss.reduce((s, x) => s + x.metro + x.note_amount + x.regional, 0);

export function traceSummaryMismatch(
  allocations: Allocation[],
  companies: CompanyLike[],
): SummaryMismatchTrace {
  const valid = allocations.filter((a) => a.hasValid);
  const primaries = keepRevisitPrimaryOnly(valid.map((a) => a.row));
  const primaryIds = new Set(primaries.map((r) => r.id!).filter(Boolean));

  const activeById = new Map(
    companies.filter((c) => c.active).map((c) => [c.id, c]),
  );
  const activeByName = new Map(
    companies.filter((c) => c.active).map((c) => [String(c.name || "").trim(), c]),
  );
  const matchesActive = (r: AnyRow): boolean => {
    if (r.company_id && activeById.has(r.company_id)) return true;
    const nm = String(r.company_name || "").trim();
    return !!nm && activeByName.has(nm);
  };

  const cat = {
    revisit_extra: { amt: 0, rows: [] as SMTRowRef[] },
    unmatched_company: { amt: 0, rows: [] as SMTRowRef[] },
    noncountable_share: { amt: 0, rows: [] as SMTRowRef[] },
  };

  let companyTotal = 0;
  let leaderTotal = 0;

  for (const a of valid) {
    const r = a.row;
    const rf = rowFee(r);
    const ls = shareSum(a.shares);
    leaderTotal += ls;

    const isPrimary = primaryIds.has(r.id ?? "__no_id__") || !r.revisit_group_id;
    const matched = matchesActive(r);

    if (!isPrimary) {
      if (ls > 0) {
        cat.revisit_extra.amt += ls;
        cat.revisit_extra.rows.push(refOf(r, ls, "재방문 2차+ — 팀장엔 포함, 업체엔 1차만"));
      }
      continue;
    }

    if (!matched) {
      if (ls > 0) {
        cat.unmatched_company.amt += ls;
        cat.unmatched_company.rows.push(refOf(r, ls, "활성업체와 매칭 안 됨 — 업체 합계에서 누락"));
      }
      continue;
    }

    // 매칭된 1차: 업체엔 행 금액 전액 / 팀장엔 share 합만 반영
    companyTotal += rf;
    const gap = rf - ls;
    if (Math.abs(gap) > 0.0001) {
      cat.noncountable_share.amt += Math.abs(gap);
      cat.noncountable_share.rows.push(
        refOf(
          r,
          gap,
          gap > 0
            ? "비집계 팀장 몫(거부/정산제외/가상기사) — 업체에만 포함"
            : "팀장 share 합이 행 금액 초과 — 데이터 점검 필요",
        ),
      );
    }
  }

  const components: SMTComponent[] = [
    {
      key: "revisit_extra",
      label: "재방문 2차+ (팀장만 포함)",
      sign: +1,
      amount: cat.revisit_extra.amt,
      signedAmount: +cat.revisit_extra.amt,
      rows: cat.revisit_extra.rows,
      hint: "재방문 그룹의 2회차 이상은 업체 합계엔 제외되지만 팀장 합엔 포함된다.",
    },
    {
      key: "unmatched_company",
      label: "업체 미매칭/비활성",
      sign: +1,
      amount: cat.unmatched_company.amt,
      signedAmount: +cat.unmatched_company.amt,
      rows: cat.unmatched_company.rows,
      hint: "활성 업체 목록에 잡히지 않은 행은 팀장엔 합산되고 업체엔 빠진다.",
    },
    {
      key: "noncountable_share",
      label: "비집계 팀장 몫",
      sign: -1,
      amount: cat.noncountable_share.amt,
      signedAmount: -cat.noncountable_share.amt,
      rows: cat.noncountable_share.rows,
      hint: "거부/정산제외/가상기사 자리로 분배된 몫은 업체엔 잡히고 팀장엔 빠진다.",
    },
  ];

  const reconstructed = components.reduce((s, c) => s + c.signedAmount, 0);
  const diff = leaderTotal - companyTotal;

  return {
    ok: Math.round(diff) === 0,
    companyTotal,
    leaderTotal,
    diff,
    reconstructed,
    components,
  };
}

function refOf(r: AnyRow, amount: number, note: string): SMTRowRef {
  return {
    id: r.id ?? null,
    date: r.date ?? null,
    company_id: r.company_id ?? null,
    company_name: r.company_name ?? null,
    customer_name: r.customer_name ?? null,
    item: r.item ?? null,
    amount,
    note,
  };
}