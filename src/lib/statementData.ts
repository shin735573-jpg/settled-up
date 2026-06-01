// 정산서저장 화면용 데이터 집계 헬퍼.
// 기존 splitAllocation/summaryAggregation 규칙을 그대로 재사용하면서
// "업체별" / "정산기사(팀장)별" 정산서 단위로 묶어준다.
//
// 다른 화면(업체정산/팀장정산/한눈요약)의 계산 로직은 절대 수정하지 않는다.

import { allocateRow, feeForShare, type LeaderShare } from "./splitAllocation";
import { isLeaderSettlementExcludedItem } from "./itemRules";
import {
  inPeriod,
  isCountableLeader,
  resolveSettleId,
  type Period,
  type SummaryLeader,
} from "./summaryAggregation";

export type StatementPeriod = Period;

export type StmtDelivery = {
  id: string;
  date: string;
  company_id: string | null;
  company_name: string | null;
  leader1_id: string | null;
  leader1_name: string | null;
  leader2_id: string | null;
  leader2_name: string | null;
  leader3_id: string | null;
  leader3_name: string | null;
  customer_name: string | null;
  region: string | null;
  region_type: string | null;
  item: string | null;
  note: string | null;
  metro_fee: number;
  note_amount: number;
  regional_fee: number;
  cod_amount: number;
  split_type: string | null;
  two_person: boolean | null;
  paid: boolean;
};

export type StmtCompany = {
  id: string;
  name: string;
  active: boolean;
  issues_invoice: boolean;
  vat_included: boolean;
  fee_rate_metro: number;
  fee_rate_regional: number;
  settlement_cycle: string; // 'biweekly' | 'monthly'
  account_number: string | null;
  has_cod: boolean;
  rejected_leader_id: string | null;
  rejected_leader_id_2: string | null;
  rejected_leader_id_3: string | null;
};

export type StmtLeader = SummaryLeader & {
  issues_invoice?: boolean;
  fee_rate_metro?: number;
  fee_rate_regional?: number;
  account_number?: string | null;
  min_guarantee_enabled?: boolean;
  min_guarantee_amount?: number;
};

export type PeriodKey = "h1" | "h2" | "all";
export const PERIOD_LABEL: Record<PeriodKey, string> = {
  h1: "1-15일",
  h2: "16-말일",
  all: "월전체",
};

/**
 * 행사철수 같은 "특수일" 품목 — 업체에는 같은 날짜에 1회만 청구되어야 함.
 * 팀장 정산에는 각 팀장이 입력한 행이 그대로 반영되지만,
 * 업체 청구서에서는 (date, company)별로 1행만 표시하고 금액은 비고금액 합계.
 */
export const DEFAULT_SPECIAL_ONE_TIME_ITEMS = ["행사철수"] as const;
let _specialItems = new Set<string>(DEFAULT_SPECIAL_ONE_TIME_ITEMS);
/** Settings 화면에서 등록한 특수일 품목 목록을 런타임에 주입 */
export function setSpecialOneTimeItems(labels: string[]) {
  _specialItems = new Set(
    labels.map((l) => (l ?? "").trim()).filter((l) => l.length > 0),
  );
}
export function getSpecialOneTimeItems(): string[] {
  return Array.from(_specialItems);
}
export const isSpecialOneTimeItem = (item: string | null | undefined): boolean =>
  !!item && _specialItems.has(String(item).trim());

/** 업체 정산서 1장에 들어가는 행 (분배 전, 원본 1건). */
export type CompanyStmtRow = StmtDelivery & {
  /** 업체 제출용에 표시될 팀장 표기 (거부팀장 → 별칭) */
  display_leader1: string;
  display_leader2: string;
  display_leader3: string;
  delivery_fee: number; // metro + note_amount + regional
};

export type CompanyStmtData = {
  company: StmtCompany;
  period: PeriodKey;
  rows: CompanyStmtRow[];
  // 상단 요약
  feeTotal: number;
  paidTotal: number;
  unpaidTotal: number;
  codTotal: number;
  carryInCod: number;   // 이전 이월착불 (현재 스키마 없음 → 0)
  carryOutCod: number;  // 새 이월착불
  realClaim: number;    // 실청구액
  loadingFee: number;   // 청구 적재비 (현재 스키마 없음 → 0)
  finalClaim: number;   // 실청구 + 청구 적재비
  vat: number;
  claimWithVat: number;
  // 경고/오류 (저장 전 검사용 메타)
  warnings: string[];
  errors: string[];
};

/** 팀장 정산서 1장의 행. 분배된 share + 원본 행 정보. */
export type LeaderStmtRow = {
  delivery: StmtDelivery;
  share: LeaderShare;
  // 화면 표시용
  isOeunkyuTransfer: boolean; // 오은규→오동선 표시
  unitFee: number; // 건별 수수료
  unitAfterFee: number; // 건별 계산후
  unitPayout: number; // 건별 실지급
};

export type LeaderStmtData = {
  leader: StmtLeader;
  period: PeriodKey;
  rows: LeaderStmtRow[];
  // 상단 요약
  deliveryCount: number;
  metroSum: number;
  noteSum: number;
  regionalSum: number;
  realFee: number;     // 실지급배송비 = metro + note + regional (share 기준)
  codSum: number;
  feeTotal: number;    // 수수료합계
  afterFee: number;    // 계산후 지급금액
  deductionTotal: number;
  payout: number;      // 실지급액
  vat: number;
  payoutWithVat: number;
  deductions?: LeaderDeductionDetail;
};

export type AggregateOptions = {
  shindongseokId?: string | null;
  ganghyungjuId?: string | null;
  oeunkyuId?: string | null;
  odongseonId?: string | null;
  /** 오은규 특수정산 적용 여부 (회사설정) — true면 오은규 건을 오동선에게 합산 */
  oeunkyuSpecial: boolean;
};

/** 공통공제 (쓰레기비용 등) — common_deductions 행 */
export type StmtCommonDeduction = {
  id: string;
  label: string;
  amount: number;
  active: boolean;
};
/** 팀장별 공통공제 오버라이드 — leader_common_overrides 행 */
export type StmtCommonOverride = {
  leader_id: string;
  common_deduction_id: string;
  period_key: string;
  amount: number;
};
/** 팀장별 개별공제 — leader_period_deductions 행 */
export type StmtPeriodDeduction = {
  leader_id: string;
  period_key: string;
  label: string;
  amount: number;
};

export type DeductionContext = {
  commonDeductions: StmtCommonDeduction[];
  commonOverrides: StmtCommonOverride[];
  periodDeductions: StmtPeriodDeduction[];
  /** "all" 또는 "${month}-first|second" — 개별공제 단일 키 */
  periodKey: string;
  /** 공통공제 적용 키 목록 (보름×N) — 보름1번 규칙 보장 */
  commonPeriodKeys: string[];
};

export type LeaderDeductionDetail = {
  commonLines: { label: string; amount: number; periodKey: string }[];
  personalLines: { label: string; amount: number }[];
  commonTotal: number;
  personalTotal: number;
  total: number;
};

function computeLeaderDeductions(
  leaderId: string,
  ctx: DeductionContext | undefined,
  leader?: SummaryLeader,
): LeaderDeductionDetail {
  const out: LeaderDeductionDetail = {
    commonLines: [], personalLines: [],
    commonTotal: 0, personalTotal: 0, total: 0,
  };
  if (!ctx) return out;
  const isHyungjuDongseok = (() => {
    const name = (leader?.name || "").trim();
    const aliases = leader?.aliases || [];
    return name === "강형주" || name === "신동석" || aliases.includes("형주") || aliases.includes("동석");
  })();
  const isTrashLabel = (label: string) => {
    const key = (label || "").trim().replace(/\s+/g, "").toLowerCase();
    return key.includes("쓰레기") || key.includes("trash");
  };
  // 공통공제: 활성 항목 × commonPeriodKeys (보름당 1회)
  const uniqueCommon = new Map<string, StmtCommonDeduction>();
  for (const cd of ctx.commonDeductions) {
    const key = (cd.label || "").trim().replace(/\s+/g, "").toLowerCase();
    if (cd.active && key && !uniqueCommon.has(key)) uniqueCommon.set(key, cd);
  }
  for (const cd of uniqueCommon.values()) {
    for (const pk of ctx.commonPeriodKeys) {
      const ov = ctx.commonOverrides.find(
        (o) => o.leader_id === leaderId && o.common_deduction_id === cd.id && o.period_key === pk,
      );
      const amount = ov ? Number(ov.amount) : (isHyungjuDongseok && isTrashLabel(cd.label) ? 0 : Number(cd.amount));
      if (amount > 0) {
        out.commonLines.push({ label: cd.label, amount, periodKey: pk });
        out.commonTotal += amount;
      }
    }
  }
  // 개별공제
  for (const d of ctx.periodDeductions) {
    if (d.leader_id !== leaderId || d.period_key !== ctx.periodKey) continue;
    const amount = Number(d.amount);
    if (amount > 0 && (d.label ?? "").trim() !== "") {
      out.personalLines.push({ label: d.label, amount });
      out.personalTotal += amount;
    }
  }
  out.total = out.commonTotal + out.personalTotal;
  return out;
}

/** 업체 정산서 모음 — 업체별로 1개씩 */
export function buildCompanyStatements(
  deliveries: StmtDelivery[],
  companies: StmtCompany[],
  leaders: StmtLeader[],
  period: PeriodKey,
): CompanyStmtData[] {
  const byId = new Map(leaders.map((l) => [l.id, l]));
  const out: CompanyStmtData[] = [];

  for (const c of companies) {
    if (!c.active) continue;
    // 정산주기 게이트
    if (c.settlement_cycle === "monthly" && period !== "all") continue;
    if (c.settlement_cycle !== "monthly" && period === "all") continue;

    const rejectIds = new Set(
      [c.rejected_leader_id, c.rejected_leader_id_2, c.rejected_leader_id_3].filter(Boolean) as string[],
    );
    const rows: CompanyStmtRow[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    deliveries
      .filter((d) => inPeriod(d.date, period as Period))
      .filter((d) => d.company_id === c.id || d.company_name === c.name)
      .forEach((d) => {
        const remap = (id: string | null, name: string | null): string => {
          if (!id) return name ?? "";
          if (!rejectIds.has(id)) return byId.get(id)?.name ?? name ?? "";
          const lead = byId.get(id);
          const alias = lead?.aliases?.[0];
          if (!alias || !alias.trim()) {
            errors.push(`거부팀장 "${lead?.name ?? name}" 별칭 미설정 — 업체 제출 불가`);
            return lead?.name ?? name ?? "";
          }
          return alias;
        };
        rows.push({
          ...d,
          display_leader1: remap(d.leader1_id, d.leader1_name),
          display_leader2: remap(d.leader2_id, d.leader2_name),
          display_leader3: remap(d.leader3_id, d.leader3_name),
          delivery_fee:
            Number(d.metro_fee) + Number(d.note_amount) + Number(d.regional_fee),
        });
      });

    // 행사철수 등 특수일 품목 — 같은 날짜 행들을 1건으로 합산 (업체 청구만)
    // 합산 금액 = 같은 날짜 모든 팀장 행의 비고금액 합. 수도권/지방 배송비는 0 처리.
    const collapsed: CompanyStmtRow[] = [];
    const specialBuckets = new Map<string, CompanyStmtRow[]>();
    for (const r of rows) {
      if (isSpecialOneTimeItem(r.item)) {
        const key = `${r.date}|${(r.item ?? "").trim()}`;
        const bucket = specialBuckets.get(key);
        if (bucket) bucket.push(r);
        else specialBuckets.set(key, [r]);
      } else {
        collapsed.push(r);
      }
    }
    for (const [, bucket] of specialBuckets) {
      const first = bucket[0];
      const noteSum = bucket.reduce((s, r) => s + Number(r.note_amount), 0);
      const codSum = bucket.reduce((s, r) => s + Number(r.cod_amount), 0);
      const paid = bucket.every((r) => r.paid);
      // 수도권/지방 배송비가 입력된 행이 있으면 경고 (무시됨)
      const ignoredFee = bucket.reduce(
        (s, r) => s + Number(r.metro_fee) + Number(r.regional_fee), 0);
      if (ignoredFee > 0) {
        warnings.push(
          `${first.date} ${first.item}: 수도권/지방 배송비(${Math.round(ignoredFee).toLocaleString()})는 업체 청구 시 무시되고 비고금액만 합산됩니다`,
        );
      }
      // 팀장 등장 순서대로 수집 (중복 제거). 최초 2명만 업체 청구서 팀장 칸에,
      // 나머지는 비고에 자동 추가.
      // 단, 강형주/신동석/삼호도는 업체 청구서 팀장 표시에서 제외 (금액은 이미 noteSum에 포함됨).
      const HIDDEN_TEAM = new Set(["강형주", "신동석", "형주", "동석", "삼호도", "호도"]);
      const leaderNames: string[] = [];
      const seen = new Set<string>();
      const pushLeader = (n: string) => {
        const t = (n || "").trim();
        if (!t || seen.has(t)) return;
        if (HIDDEN_TEAM.has(t)) { seen.add(t); return; }
        seen.add(t);
        leaderNames.push(t);
      };
      for (const r of bucket) {
        pushLeader(r.display_leader1);
        pushLeader(r.display_leader2);
        pushLeader(r.display_leader3);
      }
      const primary = leaderNames[0] || "";
      const secondary = leaderNames[1] || "";
      const extras = leaderNames.slice(2);
      // 오동선/오은규/김용익 팀만 팀장3까지 자동 등록 (업체 청구서 팀장칸에 함께 표시)
      const TRIO = new Set(["오동선", "오은규", "김용익", "동선", "은규", "용익"]);
      const isTrioTeam =
        leaderNames.length >= 3 && leaderNames.every((n) => TRIO.has(n));
      let tertiary = "";
      let remainingExtras = extras;
      if (isTrioTeam && extras.length > 0) {
        tertiary = extras[0];
        remainingExtras = extras.slice(1);
      }
      const extraNote = remainingExtras.length > 0 ? `추가팀장: ${remainingExtras.join(", ")}` : "";
      const mergedNote = [first.note, extraNote].filter((x) => x && String(x).trim()).join(" / ");
      collapsed.push({
        ...first,
        metro_fee: 0,
        regional_fee: 0,
        note_amount: noteSum,
        cod_amount: codSum,
        paid,
        delivery_fee: noteSum,
        customer_name: first.customer_name || first.item || "",
        display_leader1: primary,
        display_leader2: secondary,
        display_leader3: tertiary,
        note: mergedNote || first.note,
      });
    }
    // 원본 rows 자리 교체
    rows.length = 0;
    rows.push(...collapsed);

    const feeTotal = rows.reduce((s, r) => s + r.delivery_fee, 0);
    const paidTotal = rows.filter((r) => r.paid).reduce((s, r) => s + r.delivery_fee, 0);
    const unpaidTotal = feeTotal - paidTotal;
    const codTotal = rows.reduce((s, r) => s + Number(r.cod_amount), 0);
    const carryInCod = 0; // TODO: 이월착불 테이블 도입 시 연결
    const offset = codTotal + carryInCod;
    const realClaim = Math.max(0, unpaidTotal - offset);
    const carryOutCod = Math.max(0, offset - unpaidTotal);
    const loadingFee = 0; // TODO: 적재비 테이블 도입 시 연결
    const finalClaim = realClaim + loadingFee;
    // vat_included=true 인 업체는 단가에 이미 부가세가 포함되어 있으므로 추가 부과하지 않음
    const vat = c.issues_invoice && !c.vat_included ? Math.round(finalClaim * 0.1) : 0;
    const claimWithVat = c.issues_invoice ? finalClaim + vat : 0;

    out.push({
      company: c,
      period,
      rows,
      feeTotal,
      paidTotal,
      unpaidTotal,
      codTotal,
      carryInCod,
      carryOutCod,
      realClaim,
      loadingFee,
      finalClaim,
      vat,
      claimWithVat,
      warnings,
      errors,
    });
  }
  // 배송건수(rows.length)가 많은 순서대로 내림차순 정렬
  out.sort((a, b) => b.rows.length - a.rows.length);
  return out;
}

/** 팀장 정산서 모음 — 정산기사(정산포함 + settle_to_id == null) 별로 1개씩 */
export function buildLeaderStatements(
  deliveries: StmtDelivery[],
  leaders: StmtLeader[],
  period: PeriodKey,
  opts: AggregateOptions,
  deductionCtx?: DeductionContext,
): LeaderStmtData[] {
  const byId = new Map(leaders.map((l) => [l.id, l]));
  const { shindongseokId, ganghyungjuId, oeunkyuId, odongseonId } = opts;
  const kimyongikId = (opts as { kimyongikId?: string | null }).kimyongikId ?? null;

  // 정산기사 = 표시 대상 팀장
  const targets = leaders.filter((l) => isCountableLeader(l));

  // 행별 분배 미리 계산
  type Alloc = { d: StmtDelivery; shares: { share: LeaderShare; target: string }[] };
  const allocs: Alloc[] = deliveries
    .filter((d) => inPeriod(d.date, period as Period))
    .filter((d) => !isLeaderSettlementExcludedItem(d.item))
    .map((d) => {
      const shares = allocateRow(
        {
          leader1_id: d.leader1_id,
          leader2_id: d.leader2_id,
          leader3_id: d.leader3_id,
          split_type: d.split_type,
          two_person: d.two_person ?? false,
          metro_fee: Number(d.metro_fee),
          note_amount: Number(d.note_amount),
          regional_fee: Number(d.regional_fee),
          cod_amount: Number(d.cod_amount),
        },
        { shindongseokId, ganghyungjuId, oeunkyuId, odongseonId, kimyongikId },
      );
      const resolved = shares
        .map((s) => ({ share: s, target: resolveSettleId(s.leader_id, byId as Map<string, SummaryLeader>) }))
        .filter((s) => isCountableLeader(byId.get(s.target)));
      return { d, shares: resolved };
    });

  const out: LeaderStmtData[] = [];
  for (const leader of targets) {
    const rates = {
      metro: Number(leader.fee_rate_metro ?? 0),
      regional: Number(leader.fee_rate_regional ?? 0),
    };
    const rows: LeaderStmtRow[] = [];
    for (const a of allocs) {
      const mine = a.shares.filter((s) => s.target === leader.id);
      if (mine.length === 0) continue;
      // 한 행에 같은 정산기사로 두 share가 합쳐지는 경우(형주동석 재분배 등)는 합산해서 한 줄로 표시
      const sum = mine.reduce(
        (acc, x) => ({
          ...acc,
          weight: acc.weight + x.share.weight,
          metro: acc.metro + x.share.metro,
          note_amount: acc.note_amount + x.share.note_amount,
          regional: acc.regional + x.share.regional,
          cod: acc.cod + x.share.cod,
          reason: acc.reason || x.share.reason || "",
        }),
        { leader_id: leader.id, weight: 0, metro: 0, note_amount: 0, regional: 0, cod: 0, count: 1, reason: "" } as LeaderShare,
      );
      const unitFee = feeForShare(sum, rates);
      const realFee = sum.metro + sum.note_amount + sum.regional;
      const unitAfterFee = realFee - unitFee;
      const unitPayout = unitAfterFee - sum.cod;
      const isOeunkyuTransfer = !!oeunkyuId &&
        (a.d.leader1_id === oeunkyuId || a.d.leader2_id === oeunkyuId || a.d.leader3_id === oeunkyuId);
      rows.push({ delivery: a.d, share: sum, isOeunkyuTransfer, unitFee, unitAfterFee, unitPayout });
    }
    // 데이터가 없어도 목록에 표시되도록 빈 정산서를 보관 (저장대상 여부는 화면 단에서 판단)
    const metroSum = rows.reduce((s, r) => s + r.share.metro, 0);
    const noteSum = rows.reduce((s, r) => s + r.share.note_amount, 0);
    const regionalSum = rows.reduce((s, r) => s + r.share.regional, 0);
    const realFee = metroSum + noteSum + regionalSum;
    const codSum = rows.reduce((s, r) => s + r.share.cod, 0);
    const feeTotal = rows.reduce((s, r) => s + r.unitFee, 0);
    const afterFee = realFee - feeTotal;
    const ded = computeLeaderDeductions(leader.id, deductionCtx, leader);
    const deductionTotal = ded.total;
    // 정산금은 음수 불가 — 0 으로 클램프 (LeaderSettlement 마스터 화면과 동일 정책)
    const payout = Math.max(0, afterFee - codSum - deductionTotal);
    // 부가세는 실지급액(payout) 기준 10%. 청구액과 100% 일치하도록 통일.
    const vat = leader.issues_invoice ? Math.round(payout * 0.1) : 0;
    const payoutWithVat = leader.issues_invoice ? payout + vat : 0;

    out.push({
      leader,
      period,
      rows,
      deliveryCount: rows.length,
      metroSum,
      noteSum,
      regionalSum,
      realFee,
      codSum,
      feeTotal,
      afterFee,
      deductionTotal,
      payout,
      vat,
      payoutWithVat,
      deductions: ded,
    });
  }
  // 배송건수(deliveryCount)가 많은 순서대로 내림차순 정렬
  out.sort((a, b) => b.deliveryCount - a.deliveryCount);
  return out;
}

/** 한글 이름으로 강형주/신동석/오은규/오동선 id 자동 매칭 (옵션 매개변수가 비어있을 때 fallback) */
export function detectSpecialLeaderIds(leaders: { id: string; name: string }[]) {
  const find = (n: string) => leaders.find((l) => l.name.trim() === n)?.id ?? null;
  return {
    shindongseokId: find("신동석"),
    ganghyungjuId: find("강형주"),
    oeunkyuId: find("오은규"),
    odongseonId: find("오동선"),
  };
}