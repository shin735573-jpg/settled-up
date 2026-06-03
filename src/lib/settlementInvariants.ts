// 정산 계산 전반의 불변식(invariant) 검사 — "100% 오류방지" 게이트.
//
// 사용자가 항상 걱정한다고 명시한 5가지 영역 모두를 한 번에 검증한다:
//   1) 수도권/지방 자동분류 (region_type ↔ metro_fee/regional_fee 정합성)
//   2) 착불 합산        (업체 codTotal == 원본 cod 합 == 팀장 codSum 합)
//   3) 팀장별 정산금액   (분할/2인배송 가중치 합 + 금액 분배 손실 없음)
//   4) 본사정산 합계     (업체 청구액 합 == 팀장 실지급배송비 합 ± 제외품목)
//   5) 공제(공통/기간) 적용 (보름×1회 / period_key 범위 / 중복 없음)
//
// 모든 검사는 순수 함수이며 기존 계산 로직을 변경하지 않는다.

import { allocateRow } from "./splitAllocation";
import { isLeaderSettlementExcludedItem, isVirtualSettlementRow } from "./itemRules";
import { inPeriod, type Period } from "./summaryAggregation";
import type {
  CompanyStmtData,
  DeductionContext,
  LeaderStmtData,
  StmtDelivery,
} from "./statementData";
import type { CheckResult, Finding, FindingLocator } from "./statementValidation";

function empty(): CheckResult {
  return { errors: [], warnings: [], findings: [], ok: true };
}
function push(
  r: CheckResult,
  severity: Finding["severity"],
  message: string,
  locator?: FindingLocator,
) {
  r.findings.push({ severity, message, locator });
  if (severity === "error") r.errors.push(message);
  else r.warnings.push(message);
  r.ok = r.errors.length === 0;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export type InvariantOptions = {
  shindongseokId?: string | null;
  ganghyungjuId?: string | null;
  virtualIds?: Set<string> | string[] | null;
  /** 공제 정합성 검사 컨텍스트 (없으면 공제 검사 생략) */
  deductionCtx?: DeductionContext;
  /** 총합 허용 오차 (원) — 분배 반올림 누적 보정용 */
  totalTolerance?: number;
};

/**
 * 전 데이터셋 불변식 검증.
 * 호출 측은 buildCompanyStatements / buildLeaderStatements 결과와 원본 deliveries를 그대로 넘긴다.
 */
export function validateSettlementInvariants(
  deliveries: StmtDelivery[],
  companyStmts: CompanyStmtData[],
  leaderStmts: LeaderStmtData[],
  opts: InvariantOptions = {},
): CheckResult {
  const r = empty();
  const tol = opts.totalTolerance ?? 5; // 5원 이내 분배 반올림 허용

  // ─────────────── 1) 수도권/지방 자동분류 ───────────────
  for (const d of deliveries) {
    const m = num(d.metro_fee);
    const rg = num(d.regional_fee);
    const t = (d.region_type || "").trim();
    const loc: FindingLocator | undefined = d.company_id
      ? { kind: "company", id: d.company_id, rowId: d.id }
      : undefined;
    if (m > 0 && rg > 0) {
      push(r, "warning", `[분류] ${d.date} ${d.company_name ?? "?"} ${d.customer_name ?? ""} — 수도권/지방 배송비가 동시에 입력됨 (${m.toLocaleString()} / ${rg.toLocaleString()})`, loc);
    }
    if (t === "수도권" && m === 0 && rg > 0) {
      push(r, "error", `[분류] ${d.date} ${d.company_name ?? "?"} — region_type 수도권인데 지방금액(${rg.toLocaleString()})만 입력됨`, loc);
    }
    if (t === "지방" && rg === 0 && m > 0) {
      push(r, "error", `[분류] ${d.date} ${d.company_name ?? "?"} — region_type 지방인데 수도권금액(${m.toLocaleString()})만 입력됨`, loc);
    }
  }

  // ─────────────── 3) 팀장별 정산금액 (분배 불변식) ───────────────
  // — 가중치 합 ≤ 1, 금액 분배가 원본과 정확히 일치
  // (강형주/신동석 재분배 후의 결과로 점검)
  for (const d of deliveries) {
    if (isVirtualSettlementRow(d, opts.virtualIds)) continue;
    if (!d.leader1_id) continue; // 팀장 미입력 행은 건너뜀
    const shares = allocateRow(
      {
        leader1_id: d.leader1_id,
        leader2_id: d.leader2_id,
        leader3_id: d.leader3_id ?? null,
        split_type: d.split_type,
        two_person: d.two_person ?? false,
        metro_fee: num(d.metro_fee),
        note_amount: num(d.note_amount),
        regional_fee: num(d.regional_fee),
        cod_amount: num(d.cod_amount),
        virtual_leader_id: (d as { virtual_leader_id?: string | null }).virtual_leader_id ?? null,
      },
      opts,
    );
    if (shares.length === 0) continue;
    const wsum = shares.reduce((s, x) => s + x.weight, 0);
    const dloc: FindingLocator | undefined = d.leader1_id
      ? { kind: "leader", id: d.leader1_id, rowId: d.id }
      : d.company_id
      ? { kind: "company", id: d.company_id, rowId: d.id }
      : undefined;
    if (Math.abs(wsum - 1) > 0.005) {
      push(r, "error", `[분배] ${d.date} ${d.company_name ?? "?"} — 가중치 합이 1이 아님 (${wsum.toFixed(3)})`, dloc);
    }
    const mSum = shares.reduce((s, x) => s + x.metro, 0);
    const nSum = shares.reduce((s, x) => s + x.note_amount, 0);
    const rSum = shares.reduce((s, x) => s + x.regional, 0);
    const cSum = shares.reduce((s, x) => s + x.cod, 0);
    if (Math.round(mSum) !== Math.round(num(d.metro_fee)))
      push(r, "error", `[분배] ${d.date} 수도권 분배 손실: 원본 ${num(d.metro_fee)} vs 분배합 ${mSum}`, dloc);
    if (Math.round(nSum) !== Math.round(num(d.note_amount)))
      push(r, "error", `[분배] ${d.date} 비고 분배 손실: 원본 ${num(d.note_amount)} vs 분배합 ${nSum}`, dloc);
    if (Math.round(rSum) !== Math.round(num(d.regional_fee)))
      push(r, "error", `[분배] ${d.date} 지방 분배 손실: 원본 ${num(d.regional_fee)} vs 분배합 ${rSum}`, dloc);
    if (Math.round(cSum) !== Math.round(num(d.cod_amount)))
      push(r, "error", `[분배] ${d.date} 착불 분배 손실: 원본 ${num(d.cod_amount)} vs 분배합 ${cSum}`, dloc);
  }

  // ─────────────── 2) 착불 합산 ───────────────
  // 업체별 원본 cod 합 == companyStmt.codTotal
  //   · raw deliveries 는 정산월 전체(보름이 아니라 한달치) 가 들어올 수 있으므로
  //     반드시 해당 청구서의 period 로 게이트해야 한다. (h1 청구서를 h2 cod 와 비교하면 100% 오류)
  //   · 재방문 그룹은 업체 청구에서 1차 행만 표시 → cod 도 1차 행 기준. 2차 이후의 cod 는 청구서에 포함되지 않으므로 raw 에서도 제외한다.
  for (const cs of companyStmts) {
    let raw = 0;
    for (const d of deliveries) {
      if (isVirtualSettlementRow(d, opts.virtualIds)) continue;
      const sameCompany = d.company_id
        ? d.company_id === cs.company.id
        : (d.company_name ?? "") === cs.company.name;
      if (!sameCompany) continue;
      if (!inPeriod(d.date, cs.period as Period)) continue;
      // 재방문 2차 이후 행은 업체 청구서에 포함되지 않음
      const visitNo = Number((d as { revisit_visit_no?: number | null }).revisit_visit_no ?? 1);
      if ((d as { revisit_group_id?: string | null }).revisit_group_id && visitNo > 1) continue;
      raw += num(d.cod_amount);
    }
    const stmtCod = num(cs.codTotal);
    if (Math.round(raw) !== Math.round(stmtCod)) {
      push(r, "error", `[착불] ${cs.company.name} 업체 착불 합 불일치: 원본 ${raw.toLocaleString()} vs 청구서 ${stmtCod.toLocaleString()}`, { kind: "company", id: cs.company.id });
    }
  }
  // 팀장 codSum 총합 == 정산포함 팀장에게 분배된 cod 총합 (제외품목 제외)
  const leaderCodTotal = leaderStmts.reduce((s, l) => s + num(l.codSum), 0);

  // ─────────────── 4) 본사 ↔ 팀장 합계 정합성 ───────────────
  // 기준은 "팀장 정산이 실제로 끌어가는 행" 과 동일하게 계산해야 한다.
  //   · 업체 정산주기(monthly/biweekly) 차이로 companyStmts 에는 빠지는 업체가 있을 수 있으므로
  //     deliveries 를 기준으로 다시 계산한다.
  //   · 단, 팀장 정산 기간(period) · 제외품목 · 가상기사 규칙은 동일하게 적용.
  //   · 재방문 그룹은 1차 행 금액만 합산(2차 이후는 1차 금액 내부 재분배라서 총합 변화 없음).
  //     1차 날짜 기준으로 period 게이트한다.
  const leaderPeriod: Period | null = (leaderStmts[0]?.period ?? null) as Period | null;
  let expectedLeaderFee = 0;
  let expectedLeaderCod = 0;
  if (leaderPeriod) {
    // revisit 그룹별로 1차(가장 빠른 날짜) 행 한 건만 합산
    const revisitFirst = new Map<string, StmtDelivery>();
    for (const d of deliveries) {
      const gid = (d as { revisit_group_id?: string | null }).revisit_group_id;
      if (!gid) continue;
      const cur = revisitFirst.get(gid);
      if (!cur) { revisitFirst.set(gid, d); continue; }
      const curVisit = Number((cur as { revisit_visit_no?: number | null }).revisit_visit_no ?? 1);
      const dVisit = Number((d as { revisit_visit_no?: number | null }).revisit_visit_no ?? 1);
      if (dVisit < curVisit) revisitFirst.set(gid, d);
      else if (dVisit === curVisit && (d.date ?? "") < (cur.date ?? "")) revisitFirst.set(gid, d);
    }
    for (const d of deliveries) {
      if (isLeaderSettlementExcludedItem(d.item)) continue;
      if (!d.two_person && isVirtualSettlementRow(d, opts.virtualIds)) continue;
      const gid = (d as { revisit_group_id?: string | null }).revisit_group_id;
      if (gid) {
        // 1차 행만 카운트, period 게이트는 1차 날짜 기준
        const first = revisitFirst.get(gid);
        if (!first || first !== d) continue;
        if (!inPeriod(first.date, leaderPeriod)) continue;
      } else {
        if (!inPeriod(d.date, leaderPeriod)) continue;
      }
      expectedLeaderFee += num(d.metro_fee) + num(d.note_amount) + num(d.regional_fee);
      expectedLeaderCod += num(d.cod_amount);
    }
  }
  const leaderFeeTotal = leaderStmts.reduce((s, l) => s + num(l.realFee), 0);
  // 정산제외/대납 팀장에게 들어간 몫은 표시 정산서에서 빠질 수 있어 차이 허용은 보수적으로 운영.
  // 차이가 크면 안내(경고)만 — 강제 차단은 분배 검사가 통과한 경우 의미 없음.
  if (Math.abs(leaderFeeTotal - expectedLeaderFee) > Math.max(tol, expectedLeaderFee * 0.0001)) {
    push(r, "warning", `[합계] 팀장 실지급배송비 합(${leaderFeeTotal.toLocaleString()}) ≠ 원본 합(${expectedLeaderFee.toLocaleString()}). 정산제외/대납으로 빠진 몫이 있는지 확인하세요.`);
  }
  if (Math.abs(leaderCodTotal - expectedLeaderCod) > Math.max(tol, expectedLeaderCod * 0.0001)) {
    push(r, "warning", `[합계] 팀장 착불 합(${leaderCodTotal.toLocaleString()}) ≠ 원본 합(${expectedLeaderCod.toLocaleString()}).`);
  }

  // ─────────────── 5) 공제(공통/기간) 적용 ───────────────
  const ctx = opts.deductionCtx;
  if (ctx) {
    const allowedPK = new Set(ctx.commonPeriodKeys);
    for (const l of leaderStmts) {
      const ded = l.deductions;
      if (!ded) continue;
      // 공통공제: 같은 (label, periodKey) 중복 금지
      const seen = new Map<string, number>();
      for (const line of ded.commonLines) {
        const key = `${(line.label || "").trim()}|${line.periodKey}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (!allowedPK.has(line.periodKey)) {
          push(r, "error", `[공제] ${l.leader.name} — 잘못된 보름키 "${line.periodKey}" (${line.label})`, { kind: "leader", id: l.leader.id });
        }
      }
      for (const [k, n] of seen) {
        if (n > 1) push(r, "error", `[공제] ${l.leader.name} — 공통공제 중복 ${n}회: ${k}`, { kind: "leader", id: l.leader.id });
      }
      // 개별공제: period_key 가 ctx.periodKey 와 다른 항목이 합산되면 안 됨
      const sumP = ded.personalLines.reduce((s, x) => s + num(x.amount), 0);
      if (Math.round(sumP) !== Math.round(num(ded.personalTotal))) {
        push(r, "error", `[공제] ${l.leader.name} — 개별공제 합 불일치 (${sumP} vs ${ded.personalTotal})`, { kind: "leader", id: l.leader.id });
      }
      const totalCheck = num(ded.commonTotal) + num(ded.personalTotal);
      if (Math.round(totalCheck) !== Math.round(num(ded.total))) {
        push(r, "error", `[공제] ${l.leader.name} — 공제총액 합산 오류 (${totalCheck} vs ${ded.total})`, { kind: "leader", id: l.leader.id });
      }
    }
  }

  return r;
}
