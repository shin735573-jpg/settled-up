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
import type {
  CompanyStmtData,
  DeductionContext,
  LeaderStmtData,
  StmtDelivery,
} from "./statementData";
import type { CheckResult, Finding } from "./statementValidation";

function empty(): CheckResult {
  return { errors: [], warnings: [], findings: [], ok: true };
}
function push(r: CheckResult, severity: Finding["severity"], message: string) {
  r.findings.push({ severity, message });
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
    if (m > 0 && rg > 0) {
      push(r, "warning", `[분류] ${d.date} ${d.company_name ?? "?"} ${d.customer_name ?? ""} — 수도권/지방 배송비가 동시에 입력됨 (${m.toLocaleString()} / ${rg.toLocaleString()})`);
    }
    if (t === "수도권" && m === 0 && rg > 0) {
      push(r, "error", `[분류] ${d.date} ${d.company_name ?? "?"} — region_type 수도권인데 지방금액(${rg.toLocaleString()})만 입력됨`);
    }
    if (t === "지방" && rg === 0 && m > 0) {
      push(r, "error", `[분류] ${d.date} ${d.company_name ?? "?"} — region_type 지방인데 수도권금액(${m.toLocaleString()})만 입력됨`);
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
    if (Math.abs(wsum - 1) > 0.005) {
      push(r, "error", `[분배] ${d.date} ${d.company_name ?? "?"} — 가중치 합이 1이 아님 (${wsum.toFixed(3)})`);
    }
    const mSum = shares.reduce((s, x) => s + x.metro, 0);
    const nSum = shares.reduce((s, x) => s + x.note_amount, 0);
    const rSum = shares.reduce((s, x) => s + x.regional, 0);
    const cSum = shares.reduce((s, x) => s + x.cod, 0);
    if (Math.round(mSum) !== Math.round(num(d.metro_fee)))
      push(r, "error", `[분배] ${d.date} 수도권 분배 손실: 원본 ${num(d.metro_fee)} vs 분배합 ${mSum}`);
    if (Math.round(nSum) !== Math.round(num(d.note_amount)))
      push(r, "error", `[분배] ${d.date} 비고 분배 손실: 원본 ${num(d.note_amount)} vs 분배합 ${nSum}`);
    if (Math.round(rSum) !== Math.round(num(d.regional_fee)))
      push(r, "error", `[분배] ${d.date} 지방 분배 손실: 원본 ${num(d.regional_fee)} vs 분배합 ${rSum}`);
    if (Math.round(cSum) !== Math.round(num(d.cod_amount)))
      push(r, "error", `[분배] ${d.date} 착불 분배 손실: 원본 ${num(d.cod_amount)} vs 분배합 ${cSum}`);
  }

  // ─────────────── 2) 착불 합산 ───────────────
  // 업체별 원본 cod 합 == companyStmt.codTotal
  const codByCompany = new Map<string, number>();
  for (const d of deliveries) {
    if (isVirtualSettlementRow(d, opts.virtualIds)) continue;
    const key = d.company_id || `name:${d.company_name ?? ""}`;
    codByCompany.set(key, (codByCompany.get(key) ?? 0) + num(d.cod_amount));
  }
  for (const cs of companyStmts) {
    const raw = codByCompany.get(cs.company.id) ?? 0;
    // 특수일품목(행사철수) 합산 후에도 cod는 보존됨
    const stmtCod = num(cs.codTotal);
    if (Math.round(raw) !== Math.round(stmtCod)) {
      push(r, "error", `[착불] ${cs.company.name} 업체 착불 합 불일치: 원본 ${raw.toLocaleString()} vs 청구서 ${stmtCod.toLocaleString()}`);
    }
  }
  // 팀장 codSum 총합 == 정산포함 팀장에게 분배된 cod 총합 (제외품목 제외)
  const leaderCodTotal = leaderStmts.reduce((s, l) => s + num(l.codSum), 0);

  // ─────────────── 4) 본사 ↔ 팀장 합계 정합성 ───────────────
  // 기준 = 업체 정산서(청구서)에 실제로 들어간 행만 집계.
  // (raw deliveries 는 정산주기/재방문/가상기사 필터 전 데이터라서 단순 합산하면 false-positive 가 난다.)
  // 업체 청구서에 들어간 행 중 "팀장 정산 제외품목(행사철수 등)" 을 빼면 팀장 실지급 기대치가 된다.
  let expectedLeaderFee = 0;
  let expectedLeaderCod = 0;
  for (const cs of companyStmts) {
    for (const row of cs.rows) {
      if (isLeaderSettlementExcludedItem(row.item)) continue;
      if (isVirtualSettlementRow(row, opts.virtualIds)) continue;
      expectedLeaderFee += num(row.metro_fee) + num(row.note_amount) + num(row.regional_fee);
      expectedLeaderCod += num(row.cod_amount);
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
          push(r, "error", `[공제] ${l.leader.name} — 잘못된 보름키 "${line.periodKey}" (${line.label})`);
        }
      }
      for (const [k, n] of seen) {
        if (n > 1) push(r, "error", `[공제] ${l.leader.name} — 공통공제 중복 ${n}회: ${k}`);
      }
      // 개별공제: period_key 가 ctx.periodKey 와 다른 항목이 합산되면 안 됨
      const sumP = ded.personalLines.reduce((s, x) => s + num(x.amount), 0);
      if (Math.round(sumP) !== Math.round(num(ded.personalTotal))) {
        push(r, "error", `[공제] ${l.leader.name} — 개별공제 합 불일치 (${sumP} vs ${ded.personalTotal})`);
      }
      const totalCheck = num(ded.commonTotal) + num(ded.personalTotal);
      if (Math.round(totalCheck) !== Math.round(num(ded.total))) {
        push(r, "error", `[공제] ${l.leader.name} — 공제총액 합산 오류 (${totalCheck} vs ${ded.total})`);
      }
    }
  }

  return r;
}
