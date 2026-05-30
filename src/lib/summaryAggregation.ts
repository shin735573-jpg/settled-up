// 한눈요약 화면의 순수 집계 헬퍼.
// Summary.tsx의 inline 로직과 동일한 규칙을 함수로 추출 — 단위 테스트가 가능하도록.

import { allocateRow } from "./splitAllocation";

export type Period = "h1" | "h2" | "all";

export type SummaryLeader = {
  id: string;
  name: string;
  active: boolean;
  is_rejected: boolean;
  is_virtual: boolean;
  settle_to_id: string | null;
  settle_status?: "included" | "excluded" | null;
  aliases?: string[] | null;
  deduction_amount?: number;
  trash_cost?: number;
};

export type SummaryCompany = { id: string; name: string; active: boolean };

export type SummaryDelivery = {
  date: string;
  company_id: string | null;
  company_name: string | null;
  leader1_id: string | null;
  leader2_id: string | null;
  leader3_id?: string | null;
  split_type: string | null;
  two_person?: boolean | null;
  metro_fee: number;
  note_amount: number;
  regional_fee: number;
  cod_amount: number;
};

export const inPeriod = (dateStr: string, period: Period): boolean => {
  const d = Number((dateStr || "").slice(8, 10));
  if (!d) return false;
  if (period === "h1") return d >= 1 && d <= 15;
  if (period === "h2") return d >= 16;
  return true;
};

export const isCountableLeader = (l: SummaryLeader | undefined): boolean =>
  !!l && l.active && !l.is_rejected && !l.is_virtual &&
  (l.settle_status ?? "included") !== "excluded" && !l.settle_to_id;

export const resolveSettleId = (
  id: string,
  byId: Map<string, SummaryLeader>,
): string => {
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.settle_to_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    const nxt = byId.get(cur.settle_to_id);
    if (!nxt) break;
    cur = nxt;
  }
  return cur?.id ?? id;
};

export type AggregateResult = {
  companies: { id: string; name: string; count: number; fee: number; share: number }[];
  leaders: { id: string; name: string; count: number; fee: number; payout: number; share: number }[];
  companyTotal: number;
  leaderFeeTotal: number;
  diff: number;
  validRowCount: number;
};

export function aggregateSummary(
  rows: SummaryDelivery[],
  companies: SummaryCompany[],
  leaders: SummaryLeader[],
  period: Period,
  opts: { shindongseokId?: string | null; ganghyungjuId?: string | null } = {},
): AggregateResult {
  const byId = new Map(leaders.map((l) => [l.id, l]));
  const periodRows = rows.filter((r) => inPeriod(r.date, period));

  const allocations = periodRows.map((r) => {
    const shares = allocateRow(
      {
        leader1_id: r.leader1_id, leader2_id: r.leader2_id, leader3_id: r.leader3_id ?? null,
        split_type: r.split_type, two_person: r.two_person ?? false,
        metro_fee: Number(r.metro_fee), note_amount: Number(r.note_amount),
        regional_fee: Number(r.regional_fee), cod_amount: Number(r.cod_amount),
      },
      opts,
    );
    const resolved = shares
      .map((s) => ({ ...s, target: resolveSettleId(s.leader_id, byId) }))
      .filter((s) => isCountableLeader(byId.get(s.target)));
    return { row: r, shares: resolved, hasValid: resolved.length > 0 };
  });
  const validRows = allocations.filter((a) => a.hasValid);

  const visibleCompanies = companies.filter((c) => c.active);
  const companyArr = visibleCompanies.map((c) => {
    const list = validRows.filter(
      ({ row: r }) => r.company_id === c.id || r.company_name === c.name,
    );
    const fee = list.reduce(
      (s, { row: r }) =>
        s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee),
      0,
    );
    return { id: c.id, name: c.name, count: list.length, fee };
  });
  const companyTotal = companyArr.reduce((s, x) => s + x.fee, 0);
  const companiesOut = companyArr
    .map((x) => ({ ...x, share: companyTotal > 0 ? (x.fee / companyTotal) * 100 : 0 }))
    .sort((a, b) => b.fee - a.fee);

  const visibleLeaders = leaders.filter(isCountableLeader);
  const acc = new Map(
    visibleLeaders.map((l) => [
      l.id,
      {
        id: l.id, name: l.name, count: 0, fee: 0, cod: 0,
        deduct: Number(l.deduction_amount || 0) + Number(l.trash_cost || 0),
      },
    ]),
  );
  for (const { shares } of validRows) {
    const counted = new Set<string>();
    for (const s of shares) {
      const b = acc.get(s.target);
      if (!b) continue;
      if (!counted.has(s.target)) { b.count += 1; counted.add(s.target); }
      b.fee += s.metro + s.note_amount + s.regional;
      b.cod += s.cod;
    }
  }
  const leaderList = Array.from(acc.values()).map((x) => ({
    ...x,
    payout: Math.max(0, x.fee - x.cod - x.deduct),
  }));
  const leaderFeeTotal = leaderList.reduce((s, x) => s + x.fee, 0);
  const payoutGrand = leaderList.reduce((s, x) => s + x.payout, 0);
  const leadersOut = leaderList
    .map((x) => ({ ...x, share: payoutGrand > 0 ? (x.payout / payoutGrand) * 100 : 0 }))
    .sort((a, b) => b.payout - a.payout);

  return {
    companies: companiesOut,
    leaders: leadersOut,
    companyTotal,
    leaderFeeTotal,
    diff: companyTotal - leaderFeeTotal,
    validRowCount: validRows.length,
  };
}