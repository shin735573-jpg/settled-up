// 정산서저장 화면용 데이터 집계 헬퍼.
// 기존 splitAllocation/summaryAggregation 규칙을 그대로 재사용하면서
// "업체별" / "정산기사(팀장)별" 정산서 단위로 묶어준다.
//
// 다른 화면(업체정산/팀장정산/한눈요약)의 계산 로직은 절대 수정하지 않는다.

import { allocateRow, feeForShare, type LeaderShare } from "./splitAllocation";
import {
  isLeaderSettlementExcludedItem,
  isVirtualSettlementRow,
  findLoadingFeeAssignees,
  normalizeLoadingFeeRowLeaders,
} from "./itemRules";
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
  virtual_leader_id?: string | null;
  virtual_leader_name?: string | null;
  revisit_group_id?: string | null;
  revisit_visit_no?: number | null;
  alba_deduction?: number | null;
  revisit_manual_shares?: Array<{ leader_id: string; leader_name?: string | null; amount: number }> | null;
  revisit_distributed?: boolean | null;
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
export const DEFAULT_SPECIAL_ONE_TIME_ITEMS = ["행사철수", "행사상차"] as const;
let _specialItems = new Set<string>(
  DEFAULT_SPECIAL_ONE_TIME_ITEMS.map((s) => s.replace(/\s+/g, "").trim()),
);
/**
 * 업체 청구서에서 다른 특수일 품목으로 합쳐서 청구할 별칭.
 * 예: "행사상차"(신동석/강형주 입력용)는 같은 날짜 "행사철수" 금액에 합산.
 * 팀장 정산서에는 원래 입력한 품목명("행사상차")이 그대로 유지됨.
 */
const SPECIAL_ITEM_COMPANY_ALIAS: Record<string, string> = {
  "행사상차": "행사철수",
};
const normalizeItemKey = (s: string | null | undefined): string =>
  String(s ?? "").replace(/\s+/g, "").trim();
export function normalizeSpecialItemForCompany(item: string | null | undefined): string {
  const t = (item ?? "").trim();
  const k = normalizeItemKey(item);
  return SPECIAL_ITEM_COMPANY_ALIAS[k] ?? t;
}
/** Settings 화면에서 등록한 특수일 품목 목록을 런타임에 주입 */
export function setSpecialOneTimeItems(labels: string[]) {
  _specialItems = new Set(
    labels.map((l) => normalizeItemKey(l)).filter((l) => l.length > 0),
  );
  // 별칭(행사상차 등)도 항상 특수일로 인식되도록 보강
  for (const alias of Object.keys(SPECIAL_ITEM_COMPANY_ALIAS)) {
    _specialItems.add(normalizeItemKey(alias));
  }
}
export function getSpecialOneTimeItems(): string[] {
  return Array.from(_specialItems);
}
export const isSpecialOneTimeItem = (item: string | null | undefined): boolean =>
  !!item && (() => {
    const k = normalizeItemKey(item);
    if (!k) return false;
    return _specialItems.has(k)
      || Object.prototype.hasOwnProperty.call(SPECIAL_ITEM_COMPANY_ALIAS, k);
  })();

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
  kimyongikId?: string | null;
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
    //  - biweekly 업체는 "월전체(all)" 보기에서 제외 (h1/h2 두 청구서로 따로 발행됨)
    //  - monthly 업체는 원칙적으로 "월전체(all)" 보기에서 1건으로 발행하지만,
    //    h1/h2 보기에서도 해당 보름 내 실제 배송행이 있으면 그 행들만 묶어 청구서를 발행한다.
    //    (업체정산 화면 표시·팀장정산 청구합계와 정합을 맞추기 위함)
    //    실제 행 유무는 아래에서 row 누적 후 length 로 판정한다.
    if (c.settlement_cycle !== "monthly" && period === "all") continue;

    const rejectIds = new Set(
      [c.rejected_leader_id, c.rejected_leader_id_2, c.rejected_leader_id_3].filter(Boolean) as string[],
    );
    const rows: CompanyStmtRow[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    // 업체 청구서 팀장칸에서 숨길 팀장 이름 (금액은 그대로 청구됨, 이름만 비표시)
    const HIDDEN_COMPANY_LEADERS = new Set([
      "강형주", "신동석", "형주", "동석", "삼호도", "호도",
    ]);
    const isHiddenLeaderName = (n: string | null | undefined) =>
      !!n && HIDDEN_COMPANY_LEADERS.has(String(n).trim());

    // 재방문 그룹의 "기준 날짜" = 그룹 내 가장 빠른 날짜(=1차 방문).
    // 2차 방문이 다른 정산주기에 있더라도 1차 기준일이 현 주기에 속하면
    // 같이 끌어와 합산 청구한다.
    const virtualIds = new Set(leaders.filter((l) => l.is_virtual).map((l) => l.id));
    const companyDeliveries = deliveries.filter(
      (d) => {
        if (d.company_id !== c.id && d.company_name !== c.name) return false;
        // 2인배송 행은 가상기사(외부인)가 파트너로 들어있어도 실제 배송이므로 업체에 청구한다.
        if (d.two_person) return true;
        return !isVirtualSettlementRow(d, virtualIds);
      },
    );
    const revisitEarliest = new Map<string, string>();
    for (const d of companyDeliveries) {
      const gid = d.revisit_group_id;
      if (!gid) continue;
      const cur = revisitEarliest.get(gid);
      if (!cur || (d.date && d.date < cur)) revisitEarliest.set(gid, d.date);
    }

    companyDeliveries
      .filter((d) => {
        // 정책(2026-06): 착불(cod_amount > 0) 행은 업체에 청구하지 않는다.
        // 고객이 기사에게 직접 결제했으므로 업체 청구서/총배송비 합산에서 제외.
        if (Number(d.cod_amount) > 0) return false;
        const gid = d.revisit_group_id;
        if (gid) {
          const base = revisitEarliest.get(gid) ?? d.date;
          return inPeriod(base, period as Period);
        }
        return inPeriod(d.date, period as Period);
      })
      .forEach((d) => {
        const VIRTUAL_TERM_RE = /가상기사|가상팀장/;
        const remap = (id: string | null, name: string | null): string => {
          if (!id) return name ?? "";
          const lead0 = byId.get(id);
          // 가상기사(2인배송용 외부 동행기사 등)도 업체 청구서에 동행기사로 표기한다.
          // 단, 이름 자체가 "가상기사"/"가상팀장" 같은 시스템 문구이면 노출 금지(검증 차단 회피).
          if (lead0?.is_virtual) {
            const vn = (lead0?.name ?? name ?? "").trim();
            if (!vn || VIRTUAL_TERM_RE.test(vn)) return "";
            return vn;
          }
          // 숨김팀장(강형주/신동석/삼호도 등) — 업체 청구서에 이름 미표시
          if (isHiddenLeaderName(lead0?.name) || isHiddenLeaderName(name)) return "";
          if (!rejectIds.has(id)) return byId.get(id)?.name ?? name ?? "";
          const lead = byId.get(id);
          const alias = lead?.aliases?.[0];
          if (!alias || !alias.trim()) {
            errors.push(`거부팀장 "${lead?.name ?? name}" 별칭 미설정 — 업체 제출 불가`);
            return lead?.name ?? name ?? "";
          }
          if (isHiddenLeaderName(alias)) return "";
          return alias;
        };
        // virtual_leader_id / virtual_leader_name 별도 슬롯(2인배송 외부 동행기사 등)도 동행기사로 노출.
        const vId = (d as { virtual_leader_id?: string | null }).virtual_leader_id ?? null;
        const vName = (d as { virtual_leader_name?: string | null }).virtual_leader_name ?? null;
        const vDisplay = (() => {
          if (vId) {
            const v = byId.get(vId);
            const n = (v?.name ?? vName ?? "").trim();
            if (!n || VIRTUAL_TERM_RE.test(n)) return "";
            return n;
          }
          const n = (vName ?? "").trim();
          if (!n || VIRTUAL_TERM_RE.test(n)) return "";
          return n;
        })();
        // 숨김팀장 제거 후 좌측으로 압축. 가상기사는 leader 슬롯 + 별도 슬롯 모두 포함하되 중복 제거.
        const seen = new Set<string>();
        const compact: string[] = [];
        for (const n of [
          remap(d.leader1_id, d.leader1_name),
          remap(d.leader2_id, d.leader2_name),
          remap(d.leader3_id, d.leader3_name),
          vDisplay,
        ]) {
          const t = (n ?? "").trim();
          if (!t || seen.has(t)) continue;
          seen.add(t);
          compact.push(t);
        }
        rows.push({
          ...d,
          display_leader1: compact[0] ?? "",
          display_leader2: compact[1] ?? "",
          display_leader3: compact[2] ?? "",
          delivery_fee:
            Number(d.metro_fee) + Number(d.note_amount) + Number(d.regional_fee),
        });
      });

    // 행사철수 등 특수일 품목 — 같은 날짜 행들을 1건으로 합산 (업체 청구만)
    // 합산 금액 = 같은 날짜 모든 팀장 행의 비고금액 합. 수도권/지방 배송비는 0 처리.
    const collapsed: CompanyStmtRow[] = [];
    // 1) 재방문 그룹(revisit_group_id) 합산 — 1차+2차 금액 합산, 날짜=가장 빠른 날(1차), 팀장칸=1차 행 기준.
    //    팀장 정산은 buildLeaderStatements에서 행별 그대로 처리됨.
    {
      const revisitBuckets = new Map<string, CompanyStmtRow[]>();
      const passthrough: CompanyStmtRow[] = [];
      for (const r of rows) {
        const gid = (r as StmtDelivery).revisit_group_id;
        if (gid) {
          const bucket = revisitBuckets.get(gid);
          if (bucket) bucket.push(r);
          else revisitBuckets.set(gid, [r]);
        } else {
          passthrough.push(r);
        }
      }
      for (const [, bucket] of revisitBuckets) {
        // visit_no 오름차순(1차→2차)으로 정렬 후, 1차 행을 기준 행으로 사용
        const sorted = [...bucket].sort((a, b) => {
          const va = Number((a as StmtDelivery).revisit_visit_no ?? 1);
          const vb = Number((b as StmtDelivery).revisit_visit_no ?? 1);
          if (va !== vb) return va - vb;
          return (a.date || "").localeCompare(b.date || "");
        });
        const base = sorted[0];
        // 업체 청구: 재방문 그룹은 1차 행만 그대로 표시 (2차 이후는 업체에 청구하지 않음).
        // 팀장 정산은 buildLeaderStatements에서 모든 차수가 그대로 반영됨.
        passthrough.push({
          ...base,
          delivery_fee:
            Number(base.metro_fee) + Number(base.note_amount) + Number(base.regional_fee),
        });
      }
      rows.length = 0;
      rows.push(...passthrough);
    }
    // 특수일 품목(행사철수/행사상차) 버킷 — 100% 정확 매칭 규칙:
    //  1) 정상 행(행사철수)은 (고객명, 품목) 기준으로 묶는다. 고객명이 비면 날짜로 폴백.
    //     동일 (고객명, 품목)이면 상차일과 철수일이 달라도 한 청구건으로 합산.
    //  2) 별칭 행(행사상차)은 같은 고객명의 행사철수 버킷에 합산.
    //     같은 고객명 철수 버킷이 없으면 자기 단독 버킷으로 생성.
    //  3) 표시 날짜는 버킷 내 가장 빠른 날짜(통상 상차일)로 표기.
    const specialBuckets = new Map<string, CompanyStmtRow[]>();
    const normCust = (s: string | null | undefined) =>
      String(s ?? "").replace(/\s+/g, "").trim();
    const aliasedRows: CompanyStmtRow[] = [];
    for (const r of rows) {
      if (!isSpecialOneTimeItem(r.item)) { collapsed.push(r); continue; }
      const raw = String(r.item ?? "").replace(/\s+/g, "").trim();
      const isAlias = raw === "행사상차";
      if (isAlias) { aliasedRows.push(r); continue; }
      const canonical = normalizeSpecialItemForCompany(r.item);
      const cust = normCust(r.customer_name);
      const key = cust ? `C:${cust}|${canonical}` : `D:${r.date}|${canonical}`;
      const bucket = specialBuckets.get(key);
      if (bucket) bucket.push(r); else specialBuckets.set(key, [r]);
    }
    for (const r of aliasedRows) {
      const canonical = normalizeSpecialItemForCompany(r.item);
      const cust = normCust(r.customer_name);
      const key = cust ? `C:${cust}|${canonical}` : `D:${r.date}|${canonical}`;
      const bucket = specialBuckets.get(key);
      if (bucket) bucket.push(r); else specialBuckets.set(key, [r]);
    }
    for (const [bkey, bucket] of specialBuckets) {
      // 같은 고객명 버킷 내에서 가장 빠른 날짜(보통 상차일)를 대표로 표기
      bucket.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const first = bucket[0];
      // 표시용 품목명은 별칭 정규화 결과 (예: 행사상차도 업체 청구서에서는 "행사철수"로 표기)
      const canonicalItem = bkey.split("|")[1] ?? (first.item ?? "");
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
        item: canonicalItem,
        metro_fee: 0,
        regional_fee: 0,
        note_amount: noteSum,
        cod_amount: codSum,
        paid,
        delivery_fee: noteSum,
        customer_name: first.customer_name || canonicalItem || "",
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

    // 표시 행은 항상 날짜 오름차순 (동일 날짜 내에서는 입력 순서 유지)
    rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    // monthly 업체를 h1/h2 보기에서 발행할 때, 해당 보름에 실제 행도 없고
    // 이월착불도 없으면 빈 청구서를 만들지 않는다. (biweekly 업체 기존 동작은 그대로 — 
    // 빈 행이라도 carryInCod 또는 codTotal 같은 합계가 0 이상이면 청구서 발행)
    if (
      c.settlement_cycle === "monthly" &&
      period !== "all" &&
      rows.length === 0 &&
      carryInCod === 0
    ) {
      continue;
    }

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
  const virtualIds = new Set(leaders.filter((l) => l.is_virtual).map((l) => l.id));
  const { shindongseokId, ganghyungjuId, oeunkyuId, odongseonId } = opts;
  const kimyongikId = (opts as { kimyongikId?: string | null }).kimyongikId ?? null;
  // 적재비 행은 항상 "삼호" 팀장에게 귀속한다 (모든 정산에 포함).
  // 동명이인 보존: 이미 어느 삼호 ID 에 입력돼 있으면 그 ID 유지, 아니면 primary 로 라우팅.
  const samhoAssignee = findLoadingFeeAssignees(leaders);

  // 정산기사 = 표시 대상 팀장
  const targets = leaders.filter((l) => isCountableLeader(l));

  // 행별 분배 미리 계산
  type Alloc = { d: StmtDelivery; shares: { share: LeaderShare; target: string }[] };
  // 재방문 그룹은 1차 행 기준으로 묶어 별도 처리 (수기분배 또는 1차 팀장1 전액).
  const revisitGroups = new Map<string, StmtDelivery[]>();
  const singles: StmtDelivery[] = [];
  for (const d of deliveries) {
    if (isLeaderSettlementExcludedItem(d.item)) continue;
    // 2인배송 행은 가상기사가 파트너로 들어있어도 실제 배송이므로 실제 팀장에게 분배한다.
    // (allocateRow가 virtualIds를 받아 가상기사 몫은 자동 제외)
    if (!d.two_person && isVirtualSettlementRow(d, virtualIds)) continue;
    if (d.revisit_group_id) {
      const arr = revisitGroups.get(d.revisit_group_id) || [];
      arr.push(d);
      revisitGroups.set(d.revisit_group_id, arr);
    } else {
      if (!inPeriod(d.date, period as Period)) continue;
      singles.push(d);
    }
  }

  const allocs: Alloc[] = singles.map((d) => {
    const r = normalizeLoadingFeeRowLeaders(d, samhoAssignee);
    const shares = allocateRow(
      {
        leader1_id: r.leader1_id,
        leader2_id: r.leader2_id,
        leader3_id: r.leader3_id,
        split_type: r.split_type,
        two_person: r.two_person ?? false,
        metro_fee: Number(d.metro_fee),
        note_amount: Number(d.note_amount),
        regional_fee: Number(d.regional_fee),
        cod_amount: Number(d.cod_amount),
        virtual_leader_id: (r as { virtual_leader_id?: string | null }).virtual_leader_id ?? null,
      },
      { shindongseokId, ganghyungjuId, oeunkyuId, odongseonId, kimyongikId, virtualIds },
    );
    const resolved = shares
      .map((s) => ({ share: s, target: resolveSettleId(s.leader_id, byId as Map<string, SummaryLeader>) }))
      .filter((s) => isCountableLeader(byId.get(s.target)));
    return { d, shares: resolved };
  });

  // 재방문 그룹: 1차 행을 기준으로 합성 alloc 1건 생성
  for (const [, group] of revisitGroups) {
    const sorted = [...group].sort(
      (a, b) => Number(a.revisit_visit_no ?? 1) - Number(b.revisit_visit_no ?? 1),
    );
    const first = sorted[0];
    // 기간 게이트는 1차 날짜 기준
    if (!inPeriod(first.date, period as Period)) continue;
    const baseMetro = Number(first.metro_fee);
    const baseNote = Number(first.note_amount);
    const baseRegional = Number(first.regional_fee);
    const baseCod = Number(first.cod_amount);
    const useMetro = baseMetro >= baseRegional;
    const manual = Array.isArray(first.revisit_manual_shares)
      ? first.revisit_manual_shares.filter((m) => m && m.leader_id && !virtualIds.has(m.leader_id) && Number(m.amount) > 0)
      : null;
    // 재방문은 각 팀장이 실제 방문한 차수의 행에 본인 몫만 표시되어야 한다.
    // → share 단위로 sourceDelivery(어느 방문 행에 표시할지)를 함께 보관.
    const pushShare = (s: LeaderShare, src: StmtDelivery) => {
      const target = resolveSettleId(s.leader_id, byId as Map<string, SummaryLeader>);
      if (!isCountableLeader(byId.get(target))) return;
      allocs.push({ d: src, shares: [{ share: s, target }] });
    };
    if (manual && manual.length > 0) {
      const totalManual = manual.reduce((s, m) => s + Number(m.amount || 0), 0) || 1;
      for (const m of manual) {
        const amt = Math.max(0, Number(m.amount || 0));
        // 수기분배: 해당 팀장이 실제 방문한 차수의 행에 표기 (없으면 1차 행)
        const visit = sorted.find((s) => s.leader1_id === m.leader_id) ?? first;
        pushShare({
          leader_id: m.leader_id,
          weight: amt / totalManual,
          metro: useMetro ? amt : 0,
          note_amount: 0,
          regional: useMetro ? 0 : amt,
          cod: 0,
          count: 1,
          reason: "재방문 수기분배",
        }, visit);
      }
      // 비고금액 / 착불은 1차 팀장1에게 귀속 (수기 입력에 포함되지 않음)
      if (first.leader1_id && !virtualIds.has(first.leader1_id) && (baseNote !== 0 || baseCod !== 0)) {
        pushShare({
          leader_id: first.leader1_id,
          weight: 1,
          metro: 0,
          note_amount: baseNote,
          regional: 0,
          cod: baseCod,
          count: 0,
          reason: "재방문 비고/착불(1차 팀장1)",
        }, first);
      }
    } else if (first.leader1_id && !virtualIds.has(first.leader1_id)) {
      // 자동 분배 규칙:
      //  · 업체 청구 = 1차 행 금액(baseTotal) 그대로
      //  · 2차(이후) 행에 입력된 metro+note+regional 금액 = 해당 행 팀장1에게 지급, 1차 팀장1에서 차감
      //  · 1차 팀장1 + 2차 팀장 합 = 1차 청구금액
      //  · 비고/착불은 1차 팀장1에게 귀속(중복 청구 방지)
      const baseTotal = baseMetro + baseRegional; // 비고는 별도(1차 팀장1 고정)
      let assignedToSecondary = 0;
      for (let i = 1; i < sorted.length; i++) {
        const sec = sorted[i];
        const secLeader = sec.leader1_id;
        if (!secLeader || virtualIds.has(secLeader)) continue;
        if (secLeader === first.leader1_id) continue; // 동일 팀장이면 차감 없음
        const secAmt = Number(sec.metro_fee) + Number(sec.note_amount) + Number(sec.regional_fee);
        if (secAmt <= 0) continue;
        const capped = Math.min(secAmt, Math.max(0, baseTotal - assignedToSecondary));
        if (capped <= 0) continue;
        assignedToSecondary += capped;
        // 2차 이후: 그 차수 방문 행에 본인 몫만 표기
        pushShare({
          leader_id: secLeader,
          weight: baseTotal > 0 ? capped / baseTotal : 1,
          metro: useMetro ? capped : 0,
          note_amount: 0,
          regional: useMetro ? 0 : capped,
          cod: 0,
          count: 1,
          reason: "재방문 2차 분배",
        }, sec);
      }
      const firstRemaining = Math.max(0, baseTotal - assignedToSecondary);
      // 1차 팀장: 1차 방문 행에 잔여 + 비고/착불 표기 (잔여가 0이고 비고/착불도 0이면 표시 생략)
      const firstHasAmount = firstRemaining > 0 || baseNote !== 0 || baseCod !== 0;
      if (firstHasAmount) {
        const w1 = baseTotal > 0 ? firstRemaining / baseTotal : 0;
        pushShare({
          leader_id: first.leader1_id,
          weight: w1 > 0 ? w1 : 1, // 비고/착불만 남는 경우에도 양수 weight 유지
          metro: useMetro ? firstRemaining : 0,
          note_amount: baseNote,
          regional: useMetro ? 0 : firstRemaining,
          cod: baseCod,
          count: 1,
          reason: assignedToSecondary > 0 ? "재방문 1차(2차분 차감)" : "재방문 1차 전액",
        }, first);
      }
    }
  }

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
    // 표시 행은 항상 날짜 오름차순 정렬
    rows.sort((a, b) => (a.delivery.date || "").localeCompare(b.delivery.date || ""));
    // 데이터가 없어도 목록에 표시되도록 빈 정산서를 보관 (저장대상 여부는 화면 단에서 판단)
    const metroSum = rows.reduce((s, r) => s + r.share.metro, 0);
    const noteSum = rows.reduce((s, r) => s + r.share.note_amount, 0);
    const regionalSum = rows.reduce((s, r) => s + r.share.regional, 0);
    const realFee = metroSum + noteSum + regionalSum;
    const codSum = rows.reduce((s, r) => s + r.share.cod, 0);
    const feeTotal = rows.reduce((s, r) => s + r.unitFee, 0);
    const afterFee = realFee - feeTotal;
    const ded = computeLeaderDeductions(leader.id, deductionCtx, leader);
    // 배송 입력의 "알바공제"는 해당 행의 정산기사(leader1의 settle 대상)에게 귀속.
    let albaTotal = 0;
    for (const a of allocs) {
      const v = Number(a.d.alba_deduction || 0);
      if (v <= 0) continue;
      const t = resolveSettleId(a.d.leader1_id, byId as Map<string, SummaryLeader>);
      if (t === leader.id) albaTotal += v;
    }
    if (albaTotal > 0) {
      ded.personalLines.push({ label: "알바공제", amount: albaTotal });
      ded.personalTotal += albaTotal;
      ded.total += albaTotal;
    }
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
    kimyongikId: find("김용익"),
  };
}