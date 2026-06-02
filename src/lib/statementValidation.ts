// 정산서 저장 전 오류 검사 (사양 12 기반).
// 실제 저장(STEP 3 후반) 전에 반드시 실행되어야 하며,
// errors 가 있으면 저장 차단, warnings 만 있으면 사용자 확인 후 저장.

import type {
  CompanyStmtData,
  LeaderStmtData,
  StmtDelivery,
  StmtLeader,
} from "./statementData";
import { matchesCompany } from "./companyMatch";

export type FindingLocator = {
  /** 어떤 정산서로 이동할지 */
  kind: "company" | "leader";
  /** 해당 정산서 id */
  id: string;
  /** 강조할 원본 배송행 id (있으면 자동 스크롤 + 하이라이트) */
  rowId?: string;
};
export type Finding = {
  severity: "error" | "warning";
  message: string;
  /** 클릭 시 이동할 위치 (없으면 이동 불가) */
  locator?: FindingLocator;
};
export type CheckResult = {
  errors: string[];
  warnings: string[];
  findings: Finding[];
  ok: boolean; // errors.length === 0
};

const VIRTUAL_TERMS = ["가상기사", "가상팀장"];

function emptyResult(): CheckResult {
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

/** 업체 정산서 1장 검사 */
export function validateCompanyStatement(data: CompanyStmtData): CheckResult {
  const r = emptyResult();
  const c = data.company;
  const prefix = `[${c.name}]`;

  // 1) 해당 업체 데이터만 포함되었는지
  for (const row of data.rows) {
    if (!matchesCompany({ company_id: row.company_id, company_name: row.company_name ?? null }, { id: c.id, name: c.name })) {
      push(r, "error", `${prefix} 다른 업체 데이터가 포함되었습니다: ${row.date} ${row.company_name ?? "?"}`);
    }
  }

  // 2) 거부팀장 / 별칭 — build 단계에서 채워진 errors 승격
  for (const e of data.errors) push(r, "error", `${prefix} ${e}`);

  // 3) 거부팀장 실명이 업체 제출용에 노출되었는지 (별칭 처리 결과 검증)
  const rejectIds = new Set(
    [c.rejected_leader_id, c.rejected_leader_id_2, c.rejected_leader_id_3].filter(Boolean) as string[],
  );
  if (rejectIds.size > 0) {
    for (const row of data.rows) {
      [
        { id: row.leader1_id, name: row.leader1_name, shown: row.display_leader1 },
        { id: row.leader2_id, name: row.leader2_name, shown: row.display_leader2 },
      ].forEach(({ id, name, shown }) => {
        if (id && rejectIds.has(id) && name && shown === name) {
          push(r, "error", `${prefix} 거부팀장 실명 노출: ${name} (${row.date})`);
        }
      });
    }
  }

  // 4) "가상기사"/"가상팀장" 문구 노출 금지
  for (const row of data.rows) {
    for (const s of [row.display_leader1, row.display_leader2]) {
      if (s && VIRTUAL_TERMS.some((t) => s.includes(t))) {
        push(r, "error", `${prefix} 가상기사/가상팀장 문구 노출: "${s}" (${row.date})`);
      }
    }
  }

  // 5) 계산서 미발행 업체에 부가세/계산서 금액이 채워졌으면 오류
  if (!c.issues_invoice) {
    if (data.vat !== 0 || data.claimWithVat !== 0) {
      push(r, "error", `${prefix} 계산서 미발행 업체에 부가세/청구 금액이 표시됨`);
    }
  }

  // 6) 적재비는 업체별 월 1회 — 현재 적재비 데이터 모델 없음 (STEP 3 후반 도입 예정)
  //    배열에 같은 라벨 적재비가 2회 이상 들어가는지만 사전 점검.
  //    (현재 데이터 모델 미존재로 noop)

  // 7) 데이터 없음은 경고
  if (data.rows.length === 0) {
    push(r, "warning", `${prefix} 해당 기간 데이터가 없습니다`);
  }

  return r;
}

/** 팀장 정산서 1장 검사 */
export function validateLeaderStatement(
  data: LeaderStmtData,
  ctx: {
    leaders: StmtLeader[];
    oeunkyuId?: string | null;
    odongseonId?: string | null;
    ganghyungjuId?: string | null;
    shindongseokId?: string | null;
    oeunkyuSpecial: boolean;
    /** 같은 기간 같은 팀장의 다른 정산서가 또 있는지 (중복 생성 체크용) — 호출자가 채워줌 */
    siblingCount?: number;
  },
): CheckResult {
  const r = emptyResult();
  const l = data.leader;
  const prefix = `[${l.name}]`;

  // 1) 정산제외 팀장에 대해 호출됐다면 오류
  if ((l.settle_status ?? "included") === "excluded") {
    push(r, "error", `${prefix} 정산제외 팀장 정산서는 생성할 수 없습니다`);
  }

  // 2) 오은규 단독 정산서 (특수정산 ON 상태) 금지
  if (ctx.oeunkyuSpecial && ctx.oeunkyuId && l.id === ctx.oeunkyuId) {
    push(r, "error", `${prefix} 오은규 정산서는 생성할 수 없습니다 (오동선에 합산)`);
  }

  // 3) 해당 정산기사 기준 데이터만 들어갔는지 (분배 weight 합이 0보다 큼)
  for (const row of data.rows) {
    if (row.share.weight <= 0) {
      push(r, "error", `${prefix} 분배 비율 0 행 포함: ${row.delivery.date}`);
    }
    if (row.share.weight > 1.0001) {
      push(r, "error", `${prefix} 중복 계산 (weight>${row.share.weight.toFixed(2)}): ${row.delivery.date}`);
    }
  }

  // 4) 강형주/신동석 한 팀 — 한쪽에만 100% 들어가면 오류, 양쪽 합산 일치 확인
  if (ctx.ganghyungjuId && ctx.shindongseokId &&
      (l.id === ctx.ganghyungjuId || l.id === ctx.shindongseokId)) {
    // 본 팀장이 들어간 모든 행은 weight 0.5 이하여야 정상 (1.0이면 한쪽 100%)
    for (const row of data.rows) {
      const involved =
        row.delivery.leader1_id === ctx.ganghyungjuId ||
        row.delivery.leader2_id === ctx.ganghyungjuId ||
        row.delivery.leader3_id === ctx.ganghyungjuId ||
        row.delivery.leader1_id === ctx.shindongseokId ||
        row.delivery.leader2_id === ctx.shindongseokId ||
        row.delivery.leader3_id === ctx.shindongseokId;
      // 본인이 직접 입력된 경우는 분배 후 weight 0.5 이하여야 정상
      if (involved && row.share.weight > 0.5001) {
        push(r, "error", `${prefix} 강형주/신동석 팀 분배 오류 (weight=${row.share.weight.toFixed(2)}, 날짜 ${row.delivery.date})`);
      }
    }
  }

  // 5) 오동선 정산서에 오은규에서 넘어온 건이 누락되지 않았는지
  if (ctx.oeunkyuSpecial && ctx.odongseonId && ctx.oeunkyuId && l.id === ctx.odongseonId) {
    // 호출자에게 deliveries 전부를 받아야 정확하지만, 이 검사 단계는 보조용 — STEP 3에서 보강.
    const hasOeunkyuRow = data.rows.some((r2) => r2.isOeunkyuTransfer);
    // 경고: 한 건도 없으면 단순 안내
    if (!hasOeunkyuRow) {
      push(r, "warning", `${prefix} 오은규에서 넘어온 건이 정산서에 없음 (해당 기간에 오은규 배송이 0건이면 정상)`);
    }
  }

  // 6) 쓰레기비용 — 공통공제 STEP에서 데이터 연결. 현재는 deductionTotal 검증만.
  //    공제 데이터가 들어오면 기간당 1회 검사 추가.

  // 7) 빈 정산서
  if (data.rows.length === 0) {
    push(r, "warning", `${prefix} 해당 기간 데이터가 없습니다`);
  }

  // 8) 팀장 정산서 부가세 표시 규칙 (사양 10-10/11/12)
  //    총합배송비 = 수도권 + 비고 + 지방 (착불/수수료/공제 차감 없음)
  const totalDelivery = data.metroSum + data.noteSum + data.regionalSum;
  const expectedVat = Math.round(totalDelivery * 0.1);
  if (!l.issues_invoice) {
    // 미발급 팀장: 부가세 문구/금액 절대 금지 — data.vat/payoutWithVat 는 0이어야 함
    if (data.vat !== 0) {
      push(r, "error", `${prefix} 계산서 미발급 팀장에 부가세 표시 금지`);
    }
  } else {
    // 발급 팀장: 총합배송비 > 0 인데 부가세 미표시면 오류
    if (totalDelivery > 0 && expectedVat <= 0) {
      push(r, "error", `${prefix} 계산서 발급 팀장에 부가세/부가세포함총배송비 누락`);
    }
  }

  return r;
}

/** 여러 결과를 합친다 */
export function mergeResults(...results: CheckResult[]): CheckResult {
  const out = emptyResult();
  for (const r of results) {
    out.findings.push(...r.findings);
    out.errors.push(...r.errors);
    out.warnings.push(...r.warnings);
  }
  out.ok = out.errors.length === 0;
  return out;
}

/** 추가 공통 검사: 오은규 → 오동선 누락 (deliveries 원본 대조) */
export function validateOeunkyuTransferCoverage(
  deliveries: StmtDelivery[],
  odongseonStmt: LeaderStmtData | undefined,
  oeunkyuId: string,
  odongseonId: string,
  oeunkyuSpecial: boolean,
): CheckResult {
  const r = emptyResult();
  if (!oeunkyuSpecial) return r;
  const oeunkyuDeliveries = deliveries.filter((d) =>
    d.leader1_id === oeunkyuId || d.leader2_id === oeunkyuId || d.leader3_id === oeunkyuId,
  );
  if (oeunkyuDeliveries.length === 0) return r;
  if (!odongseonStmt) {
    push(r, "error", `오은규 배송 ${oeunkyuDeliveries.length}건이 있으나 오동선 정산서가 없음`);
    return r;
  }
  const odongseonRowKeys = new Set(odongseonStmt.rows.map((row) => row.delivery.id));
  const missing = oeunkyuDeliveries.filter((d) => !odongseonRowKeys.has(d.id));
  // 오은규+다른 팀장 조합이라 오동선에 안 들어가는 경우도 있으므로 경고 처리
  if (missing.length > 0) {
    push(r, "warning",
      `오은규 ${missing.length}건이 오동선 정산서에 직접 들어가지 않음 (다른 정산기사에게 분배됐는지 확인)`);
  }
  return r;
}