// 팀장정산 상단 "업체청구금액(실제)" ↔ 업체정산서(buildCompanyStatements) 100% 일치 검증.
//
// 두 값이 다를 때 어떤 규칙 때문인지 업체별 + 행별로 추적한다.
// 차이 유발 카테고리:
//   1) 비활성 업체            — active=false 인 업체는 업체정산서가 제외
//   2) 정산주기 불일치        — biweekly 업체를 month/all 보기 / monthly 업체를 first/second 보기
//   3) 특수일 품목 차이       — 행사철수/행사상차 의 수도권·지방 금액은 업체청구에서 무시
//   4) 재방문 기간 게이팅     — revisit 1차 기준일이 기간 밖이면 업체정산서가 제외
//   5) 기타(반올림 등)

import { computeCompanyBilledByCompany } from "./totalFee";
import {
  buildCompanyStatements,
  isSpecialOneTimeItem,
  type StmtDelivery,
  type StmtCompany,
  type StmtLeader,
  type PeriodKey,
} from "./statementData";

export type LeaderPeriod = "all" | "first" | "second" | "month";

export type BilledDiffRow = {
  id?: string;
  date?: string;
  company_name?: string;
  customer_name?: string;
  item?: string;
  leader1_name?: string;
  fee: number;       // metro+note+regional
  metro: number;
  note: number;
  regional: number;
  cod: number;
  note_label: string; // 어떤 규칙에 해당하는지 짧은 설명
};

export type CompanyBilledDiff = {
  companyId: string;
  companyName: string;
  leaderSide: number;      // 팀장정산 상단에 보이는 값
  companySide: number;     // 업체정산서가 청구하는 값
  diff: number;            // leaderSide - companySide
  reasons: Array<{
    code: "inactive" | "cycle" | "special" | "revisit_gating" | "other";
    label: string;
    amount: number;        // 이 카테고리가 차이에 기여한 금액 (대략값)
    rows: BilledDiffRow[];
  }>;
};

export type CompanyBilledCrossCheck = {
  ok: boolean;
  leaderTotal: number;
  companyTotal: number;
  diff: number;
  perCompany: CompanyBilledDiff[]; // diff !== 0 인 업체만
};

const num = (v: unknown) => Number(v) || 0;

function periodToStmtKeys(p: LeaderPeriod): PeriodKey[] {
  if (p === "first") return ["h1"];
  if (p === "second") return ["h2"];
  if (p === "all") return ["all"]; // monthly 업체만
  // month — 보름 두 개 합산
  return ["h1", "h2"];
}

function companySideBilled(
  deliveries: StmtDelivery[],
  companies: StmtCompany[],
  leaders: StmtLeader[],
  period: LeaderPeriod,
): Map<string, number> {
  const out = new Map<string, number>();
  const keys = periodToStmtKeys(period);
  for (const k of keys) {
    const stmts = buildCompanyStatements(deliveries, companies, leaders, k);
    for (const s of stmts) {
      const billed = s.company.issues_invoice ? s.claimWithVat : s.finalClaim;
      out.set(s.company.id, (out.get(s.company.id) || 0) + billed);
    }
  }
  return out;
}

export function crossCheckCompanyBilled(
  deliveries: StmtDelivery[],
  companies: StmtCompany[],
  leaders: StmtLeader[],
  period: LeaderPeriod,
  virtualIds?: Set<string> | string[] | null,
): CompanyBilledCrossCheck {
  // 1) 팀장정산 화면 값
  const leaderMap = computeCompanyBilledByCompany(
    deliveries as unknown as Parameters<typeof computeCompanyBilledByCompany>[0],
    companies as unknown as Parameters<typeof computeCompanyBilledByCompany>[1],
    virtualIds,
  );
  // 2) 업체정산서 값
  const companyMap = companySideBilled(deliveries, companies, leaders, period);

  let leaderTotal = 0;
  let companyTotal = 0;
  for (const v of leaderMap.values()) leaderTotal += v.billed || 0;
  for (const v of companyMap.values()) companyTotal += v || 0;

  const allIds = new Set<string>([...leaderMap.keys(), ...companyMap.keys()]);
  const perCompany: CompanyBilledDiff[] = [];

  for (const id of allIds) {
    const cInfo = companies.find((c) => c.id === id);
    const leaderSide = leaderMap.get(id)?.billed || 0;
    const companySide = companyMap.get(id) || 0;
    const diff = leaderSide - companySide;
    if (Math.abs(diff) < 1) continue;

    const reasons: CompanyBilledDiff["reasons"] = [];
    const compDeliveries = deliveries.filter((d) =>
      d.company_id === id ||
      (cInfo && d.company_name && d.company_name.trim() === cInfo.name.trim()),
    );

    // A) 비활성 업체
    if (cInfo && !cInfo.active) {
      reasons.push({
        code: "inactive",
        label: `비활성 업체 — 업체정산서에서 전체 제외`,
        amount: leaderSide,
        rows: compDeliveries.map((d) => toDiffRow(d, cInfo.name, "비활성 업체 행")),
      });
    }

    // B) 정산주기 불일치
    if (cInfo && cInfo.active) {
      const cycleSkippedAll =
        (period === "all" && cInfo.settlement_cycle !== "monthly") ||
        (period !== "all" && cInfo.settlement_cycle === "monthly");
      if (cycleSkippedAll) {
        reasons.push({
          code: "cycle",
          label: `정산주기(${cInfo.settlement_cycle}) ↔ 현재 보기(${period}) 불일치 — 업체정산서 전체 제외`,
          amount: leaderSide,
          rows: compDeliveries.map((d) =>
            toDiffRow(d, cInfo.name, `cycle=${cInfo.settlement_cycle}, view=${period}`),
          ),
        });
      }
    }

    // C) 특수일 품목 — metro/regional 무시
    const specialRows = compDeliveries.filter(
      (d) => isSpecialOneTimeItem(d.item) && (num(d.metro_fee) + num(d.regional_fee)) > 0,
    );
    if (specialRows.length > 0) {
      const amount = specialRows.reduce(
        (s, d) => s + num(d.metro_fee) + num(d.regional_fee),
        0,
      );
      reasons.push({
        code: "special",
        label: `특수일 품목(행사철수/행사상차) 수도권·지방 금액은 업체청구에서 무시`,
        amount,
        rows: specialRows.map((d) =>
          toDiffRow(
            d,
            cInfo?.name,
            `metro+regional=${(num(d.metro_fee) + num(d.regional_fee)).toLocaleString()}원 무시`,
          ),
        ),
      });
    }

    // D) 재방문 기간 게이팅 — leader-side 는 단순히 가장 빠른 행을 1차로 잡지만,
    //    company-side 는 1차 행의 date 가 기간 밖이면 전체 그룹을 제외한다.
    //    여기서는 deliveries 가 이미 기간 필터된 상태이므로 "그룹 내 1차 행이 기간 밖이라
    //    이 보기에는 안들어왔지만 2차+만 들어온 케이스"를 탐지한다.
    const revisitSuspect = detectRevisitGating(compDeliveries);
    if (revisitSuspect.length > 0) {
      const amount = revisitSuspect.reduce(
        (s, d) => s + num(d.metro_fee) + num(d.note_amount) + num(d.regional_fee),
        0,
      );
      reasons.push({
        code: "revisit_gating",
        label: `재방문 그룹의 1차 행이 다른 기간이라 업체정산서에서 제외됨`,
        amount,
        rows: revisitSuspect.map((d) =>
          toDiffRow(d, cInfo?.name, `revisit_visit_no=${d.revisit_visit_no ?? "?"}`),
        ),
      });
    }

    // E) 설명되지 않은 나머지
    const explained = reasons.reduce((s, r) => s + Math.abs(r.amount), 0);
    const residual = Math.abs(diff) - explained;
    if (residual > 1) {
      reasons.push({
        code: "other",
        label: "기타(반올림·VAT 등 — 미설명 잔차)",
        amount: residual,
        rows: [],
      });
    }

    perCompany.push({
      companyId: id,
      companyName: cInfo?.name || leaderMap.get(id)?.name || "(이름없음)",
      leaderSide,
      companySide,
      diff,
      reasons,
    });
  }

  perCompany.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const totalDiff = leaderTotal - companyTotal;
  return {
    ok: Math.abs(totalDiff) < 1 && perCompany.length === 0,
    leaderTotal,
    companyTotal,
    diff: totalDiff,
    perCompany,
  };
}

function toDiffRow(d: StmtDelivery, companyName?: string, note?: string): BilledDiffRow {
  return {
    id: d.id,
    date: d.date,
    company_name: companyName ?? d.company_name ?? undefined,
    customer_name: d.customer_name ?? undefined,
    item: d.item ?? undefined,
    leader1_name: d.leader1_name ?? undefined,
    fee: num(d.metro_fee) + num(d.note_amount) + num(d.regional_fee),
    metro: num(d.metro_fee),
    note: num(d.note_amount),
    regional: num(d.regional_fee),
    cod: num(d.cod_amount),
    note_label: note ?? "",
  };
}

function detectRevisitGating(deliveries: StmtDelivery[]): StmtDelivery[] {
  // 같은 revisit_group_id 안에 visit_no >= 2 인 행은 있는데 visit_no=1 행이 없으면
  // 1차가 다른 기간에 있다는 뜻 → 이 그룹의 모든 행이 업체정산서에서 청구되지 않음.
  const byGid = new Map<string, StmtDelivery[]>();
  for (const d of deliveries) {
    const gid = d.revisit_group_id;
    if (!gid) continue;
    const arr = byGid.get(gid) || [];
    arr.push(d);
    byGid.set(gid, arr);
  }
  const out: StmtDelivery[] = [];
  for (const [, arr] of byGid) {
    const hasFirst = arr.some((d) => Number(d.revisit_visit_no ?? 1) === 1);
    if (!hasFirst) out.push(...arr);
  }
  return out;
}