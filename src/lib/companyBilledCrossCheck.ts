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
  type CompanyStmtData,
} from "./statementData";
import { isVirtualSettlementRow } from "./itemRules";

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
  components: BilledComponent[]; // 항목별 분해 (수도권/지방/비고/착불/청구액/VAT/반올림/최종)
  reasons: Array<{
    code: "inactive" | "cycle" | "special" | "revisit_gating" | "other";
    label: string;
    amount: number;        // 이 카테고리가 차이에 기여한 금액 (대략값)
    rows: BilledDiffRow[];
  }>;
};

/** 항목별 분해 — 팀장정산 vs 업체정산서 동일 항목을 좌우 비교한다. */
export type BilledComponent = {
  key:
    | "metro" | "regional" | "note"
    | "cod_offset" | "claim" | "vat" | "rounding" | "final";
  label: string;
  leader: number;
  company: number;
  diff: number;
  hint?: string; // 차이 발생 시 안내문
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

  // 업체정산서 결과 캐시 (항목별 비교에 사용)
  const stmtByCompany = new Map<string, CompanyStmtData[]>();
  for (const k of periodToStmtKeys(period)) {
    for (const s of buildCompanyStatements(deliveries, companies, leaders, k)) {
      const arr = stmtByCompany.get(s.company.id) || [];
      arr.push(s);
      stmtByCompany.set(s.company.id, arr);
    }
  }

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

    // ─── 항목별 분해 (수도권/지방/비고/착불/청구액/VAT/반올림/최종) ──────────
    const components = breakdownComponents(
      compDeliveries,
      stmtByCompany.get(id) ?? [],
      cInfo,
      virtualIds,
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
    //   - biweekly 업체 × "월전체(all)" 보기 → 업체정산서 전체 제외 (그대로)
    //   - monthly 업체 × h1/h2 보기 → 이제 해당 보름의 행이 있으면 발행되므로
    //     "전체 제외" 사유에서 빠짐. 행이 있는데도 0원이라면 다른 사유(특수일/재방문 등)
    //     로 잡혀야 정상.
    if (cInfo && cInfo.active) {
      const cycleSkippedAll =
        period === "all" && cInfo.settlement_cycle !== "monthly";
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
      components,
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

/**
 * 항목별 분해 계산 — 팀장정산식과 업체정산서식 양쪽의 동일 항목 값을 산출한다.
 * 수도권/지방/비고 합계, 착불 상계, 청구액(VAT 전), VAT, 반올림, 최종.
 */
function breakdownComponents(
  compDeliveries: StmtDelivery[],
  stmts: CompanyStmtData[],
  cInfo: StmtCompany | undefined,
  virtualIds?: Set<string> | string[] | null,
): BilledComponent[] {
  // ── 팀장정산식 ──: computeCompanyBilledByCompany 와 동일한 billableRows 산정
  const billable = compDeliveries.filter(
    (d) => d.two_person || !isVirtualSettlementRow(d, virtualIds),
  );
  const earliest = new Map<string, string>();
  for (const d of billable) {
    const gid = d.revisit_group_id;
    if (!gid) continue;
    const cur = earliest.get(gid);
    const dt = String(d.date || "");
    if (!cur || (dt && dt < cur)) earliest.set(gid, dt);
  }
  const leaderRows = billable.filter((d) => {
    const gid = d.revisit_group_id;
    if (!gid) return true;
    const first = earliest.get(gid);
    return !!first && String(d.date || "") === first;
  });
  const L = {
    metro: sum(leaderRows, "metro_fee"),
    regional: sum(leaderRows, "regional_fee"),
    note: sum(leaderRows, "note_amount"),
    cod: sum(leaderRows, "cod_amount"),
    paid: leaderRows.filter((r) => r.paid).reduce(
      (s, r) => s + num(r.metro_fee) + num(r.note_amount) + num(r.regional_fee), 0,
    ),
  };
  const Lfee = L.metro + L.note + L.regional;
  const Lunpaid = Lfee - L.paid;
  // 정책(2026-06): 착불은 보고용 → 청구액 상계 없음.
  const Lclaim = Math.max(0, Lunpaid);
  const issues = !!cInfo?.issues_invoice;
  const Lvat = issues && !cInfo?.vat_included ? Math.round(Lclaim * 0.1) : 0;
  const Lbilled = issues ? Lclaim + Lvat : Lclaim;

  // ── 업체정산서식 ──: buildCompanyStatements 결과 합산
  let C = { metro: 0, regional: 0, note: 0, cod: 0, claim: 0, vat: 0, billed: 0 };
  for (const s of stmts) {
    for (const r of s.rows) {
      C.metro += num(r.metro_fee);
      C.regional += num(r.regional_fee);
      C.note += num(r.note_amount);
      C.cod += num(r.cod_amount);
    }
    C.claim += s.realClaim;
    C.vat += s.vat;
    C.billed += s.company.issues_invoice ? s.claimWithVat : s.finalClaim;
  }

  const rows: BilledComponent[] = [
    cmp("metro", "수도권배송비", L.metro, C.metro, "행사철수/상차 행 수도권 금액은 업체청구에서 0 처리"),
    cmp("regional", "지방배송비", L.regional, C.regional, "행사철수/상차 행 지방 금액은 업체청구에서 0 처리"),
    cmp("note", "비고금액(행사철수 포함)", L.note, C.note, "재방문/기간 게이팅 또는 비활성/정산주기로 인한 차이"),
    cmp("cod_offset", "착불 (보고용, 청구 미반영)", L.cod, C.cod, "착불은 표시·보고용 — 청구 금액 산정에는 영향 없음"),
    cmp("claim", "1차 청구액 (unpaid, 0 이상)", Lclaim, C.claim, "위 항목 차이가 누적되어 발생"),
    cmp("vat", "VAT (청구액 10%)", Lvat, C.vat, "청구액이 다르면 VAT 도 달라짐"),
    cmp(
      "rounding",
      "반올림 (VAT 라운딩 누적)",
      Lvat - Math.round(Lclaim * 0.1),
      C.vat - C.claim * 0.1,
      "Math.round 적용 차이",
    ),
    cmp("final", "최종 청구금액", Lbilled, C.billed),
  ];
  return rows;
}

function cmp(
  key: BilledComponent["key"],
  label: string,
  leader: number,
  company: number,
  hint?: string,
): BilledComponent {
  const diff = Math.round(leader - company);
  return {
    key, label,
    leader: Math.round(leader),
    company: Math.round(company),
    diff,
    hint: Math.abs(diff) >= 1 ? hint : undefined,
  };
}

function sum<K extends keyof StmtDelivery>(rows: StmtDelivery[], k: K): number {
  let s = 0;
  for (const r of rows) s += num((r as unknown as Record<string, unknown>)[k as string]);
  return s;
}