import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useArrowKeyNav } from "@/hooks/useArrowKeyNav";
import { sortLeadersByFeeAsc } from "@/lib/leaderSort";
import { totalLeaderSettlementDeliveryFee, totalUnifiedDeliveryFee, computeCompanyBilledByCompany } from "@/lib/totalFee";
import { crossCheckTotalFee } from "@/lib/totalFeeCrossCheck";
import { TotalFeeMismatchBanner } from "@/components/TotalFeeMismatchBanner";
import { crossCheckCompanyBilled } from "@/lib/companyBilledCrossCheck";
import { CompanyBilledMismatchBanner } from "@/components/CompanyBilledMismatchBanner";
import { crossCheckTotalVsBilled } from "@/lib/totalVsBilledCrossCheck";
import { TotalVsBilledMismatchBanner } from "@/components/TotalVsBilledMismatchBanner";
import { isLeaderSettlementExcludedItem, isVirtualSettlementRow } from "@/lib/itemRules";
import { useSaveConfirm } from "@/components/SaveConfirmDialog";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { fmt } from "@/lib/format";
import { getDisplayName } from "@/lib/leaderResolver";
import { allocateRow, feeForShare } from "@/lib/splitAllocation";
import { auditDeliveries } from "@/lib/liveAudit";
import { AuditBanner } from "@/components/AuditBanner";
import PrintButton from "@/components/PrintButton";
import {
  isInEffectivePeriod as __isInEffectivePeriod,
  settleOverridePrefix as __settleOverridePrefix,
  withEffectiveDate as __withEffectiveDate,
} from "@/lib/missingOverride";
import { Switch } from "@/components/ui/switch";
import { getCurrentHalf, useAutoPeriodSync } from "@/lib/autoPeriod";

type Period = "all" | "first" | "second" | "month";

// ===== 팀장정산 전체 목록 컬럼 정의 (헤더/바디 단일 소스) =====
type LeaderColKey =
  | "name" | "count" | "metro" | "note" | "regional"
  | "cod" | "deduction" | "total" | "afterFees" | "detail";

type LeaderCol = {
  key: LeaderColKey;
  label: string;
  width: number; // px (최소 너비, table-fixed + colgroup 으로 헤더/바디 동일 적용)
  align: "center";
};

const LEADER_COLUMNS: LeaderCol[] = [
  { key: "name",       label: "팀장명",       width: 160, align: "center" },
  { key: "count",      label: "배송건수",     width: 120, align: "center" },
  { key: "metro",      label: "수도권배송비", width: 160, align: "center" },
  { key: "note",       label: "비고금액",     width: 140, align: "center" },
  { key: "regional",   label: "지방배송비",   width: 160, align: "center" },
  { key: "cod",        label: "착불합계",     width: 140, align: "center" },
  { key: "deduction",  label: "공제총액",     width: 140, align: "center" },
  { key: "total",      label: "총합배송비",   width: 160, align: "center" },
  { key: "afterFees",  label: "수수료제외금액", width: 160, align: "center" },
  { key: "detail",     label: "상세보기",     width: 120, align: "center" },
];
const LEADER_TABLE_MIN_WIDTH = LEADER_COLUMNS.reduce((s, c) => s + c.width, 0);

type Leader = {
  id: string; name: string; aliases?: string[] | null; display_suffix?: string | null;
  is_rejected: boolean; is_virtual: boolean; active: boolean;
  settle_to_id: string | null; fee_rate_metro: number; fee_rate_regional: number;
  deduction_amount: number; trash_cost: number;
  settle_status?: "included" | "excluded" | null;
  issues_invoice?: boolean | null;
};
type Delivery = {
  id: string; date: string; company_id: string | null; company_name: string;
  customer_name: string | null; region: string | null; item: string | null; note: string | null;
  metro_fee: number; note_amount: number; regional_fee: number; cod_amount: number;
  region_type: string | null; split_type: string | null; paid: boolean; two_person?: boolean | null;
  leader1_id: string | null; leader1_name: string | null;
  leader2_id: string | null; leader2_name: string | null;
  leader3_id: string | null; leader3_name: string | null;
  virtual_leader_id?: string | null; virtual_leader_name?: string | null;
  revisit_group_id?: string | null;
  revisit_visit_no?: number | null;
  revisit_manual_shares?: unknown;
  alba_deduction?: number | null;
};
type CommonDeduction = { id: string; label: string; amount: number; active: boolean };
type LeaderPeriodDeduction = {
  id: string; leader_id: string; period_key: string;
  label: string; amount: number; sort_order: number;
};
type LeaderCommonOverride = {
  id: string; leader_id: string; period_key: string;
  common_deduction_id: string; amount: number;
};

const num = (v: unknown) => Number(v ?? 0) || 0;
const sumFee = (r: Delivery) => num(r.metro_fee) + num(r.note_amount) + num(r.regional_fee);
const normalizeDeductionLabel = (v: string) => v.trim().replace(/\s+/g, "").toLowerCase();
const isTrashDeductionLabel = (v: string) => {
  const key = normalizeDeductionLabel(v || "");
  return key.includes("쓰레기") || key.includes("trash");
};

/** 행에서 정산기사(=정산귀속 후의 팀장) ID 찾기. settle_to_id 따라 redirect. */
function settlementLeaderIdFor(r: Delivery, byId: Map<string, Leader>): string | null {
  for (const id of [r.leader1_id, r.leader2_id, r.leader3_id]) {
    if (!id) continue;
    const l = byId.get(id);
    if (!l) continue;
    let cur: Leader | undefined = l;
    const seen = new Set<string>();
    while (cur?.settle_to_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      const nxt = byId.get(cur.settle_to_id);
      if (!nxt) break;
      cur = nxt;
    }
    return cur?.id ?? l.id;
  }
  return null;
}

function realLeaderIdFor(r: Delivery, byId: Map<string, Leader>): string | null {
  const id = r.leader1_id;
  if (!id) return null;
  return byId.has(id) ? id : null;
}

export default function LeaderSettlement() {
  const { user } = useAuth();
  const { confirm: confirmSave, dialog: saveConfirmDialog } = useSaveConfirm();
  const initial = useMemo(() => getCurrentHalf(), []);
  const [month, setMonth] = useState(() => initial.month);
  const [period, setPeriod] = useState<Period>(initial.half === "h1" ? "first" : "second");
  const [autoPeriod, setAutoPeriod] = useState<boolean>(() => {
    try { return localStorage.getItem("leaderSettlement.autoPeriod") !== "0"; } catch { return true; }
  });
  const toggleAutoPeriod = (v: boolean) => {
    setAutoPeriod(v);
    try { localStorage.setItem("leaderSettlement.autoPeriod", v ? "1" : "0"); } catch { /* noop */ }
    if (v) {
      const cur = getCurrentHalf();
      setMonth(cur.month);
      setPeriod(cur.half === "h1" ? "first" : "second");
    }
  };
  useAutoPeriodSync(autoPeriod, () => {
    const cur = getCurrentHalf();
    const wantP: Period = cur.half === "h1" ? "first" : "second";
    setMonth((prev) => (prev === cur.month ? prev : cur.month));
    setPeriod((prev) => (prev === wantP ? prev : wantP));
  });
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [companies, setCompanies] = useState<Array<{
    id: string; name: string; issues_invoice: boolean;
    vat_included: boolean;
    settlement_cycle: string;
    active: boolean;
    rejected_leader_id: string | null;
    rejected_leader_id_2: string | null;
    rejected_leader_id_3: string | null;
  }>>([]);
  const [leaderId, setLeaderId] = useState<string>("");
  const [leaderSearch, setLeaderSearch] = useState("");
  const [commonDeductions, setCommonDeductions] = useState<CommonDeduction[]>([]);
  const [periodDeductions, setPeriodDeductions] = useState<LeaderPeriodDeduction[]>([]);
  const [detailDeductions, setDetailDeductions] = useState<LeaderPeriodDeduction[]>([]);
  const [savingDeductions, setSavingDeductions] = useState(false);
  const [commonOverrides, setCommonOverrides] = useState<LeaderCommonOverride[]>([]);
  // 상세 화면에서 편집 중인 공통공제 값 (cd_id -> amount). undefined면 base 사용.
  const [detailCommonEdits, setDetailCommonEdits] = useState<Record<string, number>>({});
  const [savingCommon, setSavingCommon] = useState(false);
  const [leaderColAlignError, setLeaderColAlignError] = useState(false);

  const periodKey = useMemo(() => (period === "all" ? "all" : `${month}-${period}`), [month, period]);

  /**
   * 공통공제(쓰레기비용 등) 적용 기준이 되는 정산기간 키 목록.
   * - 1~15일 / 16~말일: 해당 기간 1번
   * - 월전체: 1~15일 + 16~말일 두 번 (합산)
   * - 전체기간: 단일 키 "all" 1번
   * 같은 보름 기간 안에서는 절대 2번 이상 차감되지 않음 (배송건 수 무관, 팀장 × 보름 = 1번).
   */
  const commonPeriodKeys = useMemo<string[]>(() => {
    if (period === "all") return ["all"];
    if (period === "month") return [`${month}-first`, `${month}-second`];
    return [`${month}-${period}`];
  }, [period, month]);
  const commonKeysJoined = commonPeriodKeys.join(",");
  const isMultiCommonPeriod = commonPeriodKeys.length > 1;

  useEffect(() => {
    (async () => {
      const [{ data: l }, { data: cd }, { data: co }] = await Promise.all([
        supabase.from("team_leaders").select("*").order("name"),
        supabase.from("common_deductions").select("id,label,amount,active").order("sort_order"),
        supabase.from("companies").select("id,name,active,issues_invoice,vat_included,settlement_cycle,rejected_leader_id,rejected_leader_id_2,rejected_leader_id_3").order("name"),
      ]);
      setLeaders(sortLeadersByFeeAsc((l as Leader[]) || []));
      setCommonDeductions((cd as CommonDeduction[]) || []);
      setCompanies((co as any) || []);
    })();
  }, []);

  const range = useMemo(() => {
    if (period === "all") return { start: null as string | null, end: null as string | null };
    const start = month + "-01";
    const next = new Date(month + "-01"); next.setMonth(next.getMonth() + 1);
    if (period === "first") return { start, end: `${month}-16` };
    if (period === "second") return { start: `${month}-16`, end: next.toISOString().slice(0, 10) };
    return { start, end: next.toISOString().slice(0, 10) };
  }, [month, period]);

  useEffect(() => {
    (async () => {
      let q = supabase.from("deliveries").select("*").order("date");
      if (range.start) q = q.gte("date", range.start);
      if (range.end) q = q.lt("date", range.end);
      const [{ data }, { data: ovData }] = await Promise.all([
        q,
        supabase
          .from("deliveries")
          .select("*")
          .ilike("missing_reason", `${__settleOverridePrefix(month)}%`),
      ]);
      const periodKey: "h1" | "h2" | "all" =
        period === "first" ? "h1" : period === "second" ? "h2" : "all";
      const merged = new Map<string, Delivery>();
      for (const d of (data as Delivery[]) || []) merged.set((d as { id: string }).id, d);
      for (const d of (ovData as Delivery[]) || []) merged.set((d as { id: string }).id, d);
      const filtered = Array.from(merged.values())
        .filter((d) => __isInEffectivePeriod(d as { date?: string; missing_reason?: string | null }, month, periodKey))
        .map((d) => __withEffectiveDate(d as { date?: string; missing_reason?: string | null }) as Delivery);
      setRows(filtered);
    })();
  }, [range.start, range.end, month, period]);

  // 현 기간의 모든 팀장 개별공제 (마스터 합계용)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("leader_period_deductions")
        .select("*")
        .eq("period_key", periodKey);
      setPeriodDeductions((data as LeaderPeriodDeduction[]) || []);
    })();
  }, [periodKey]);

  // 현 기간의 모든 팀장 공통공제 개별 오버라이드 (마스터 합계용)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("leader_common_overrides")
        .select("*")
        .in("period_key", commonPeriodKeys);
      setCommonOverrides((data as LeaderCommonOverride[]) || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commonKeysJoined]);

  const leadersById = useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);

  /** 신동석/강형주 팀장 ID — 정식명 또는 별칭(동석/형주)으로 매칭. 재분배에 사용. */
  const findLeaderIdByNames = (names: string[]): string | null => {
    for (const l of leaders) {
      const nm = (l.name || "").trim();
      const al = (l.aliases || []).map((a) => (a || "").trim());
      if (names.some((n) => n === nm || al.includes(n))) return l.id;
    }
    return null;
  };
  const shindongseokId = useMemo(
    () => findLeaderIdByNames(["신동석", "동석"]),
    [leaders],
  );
  const ganghyungjuId = useMemo(
    () => findLeaderIdByNames(["강형주", "형주"]),
    [leaders],
  );
  const oeunkyuId = useMemo(() => findLeaderIdByNames(["오은규"]), [leaders]);
  const odongseonId = useMemo(() => findLeaderIdByNames(["오동선"]), [leaders]);
  const kimyongikId = useMemo(() => findLeaderIdByNames(["김용익"]), [leaders]);
  const virtualIds = useMemo(
    () => new Set(leaders.filter((l) => l.is_virtual).map((l) => l.id)),
    [leaders],
  );
  const sdsOpts = { shindongseokId, ganghyungjuId, oeunkyuId, odongseonId, kimyongikId, virtualIds };
  const settlementRows = useMemo(
    () => rows.filter((r) => !isVirtualSettlementRow(r, virtualIds)),
    [rows, virtualIds],
  );

  /**
   * 재방문 그룹 재분배 오버라이드.
   * - 업체 청구는 1차 행 금액만 사용(중복 청구 방지 — 다른 화면의 keepRevisitPrimaryOnly와 동일 원칙).
   * - 팀장 정산은 차수별로 분배:
   *   · 2차+ 행에 입력된 금액은 그 행 팀장1에게 지급 (단, 1차 청구금액 한도 내)
   *   · 1차 팀장1은 baseTotal(1차 metro+regional) − 2차 분배 합계
   *   · 비고/착불은 1차 팀장1 고정
   * - 수기분배(revisit_manual_shares)가 있으면 그것을 우선 적용.
   * rowId → 해당 행의 override shares. null/undefined면 일반 allocateRow 사용.
   */
  type RevisitShare = {
    leader_id: string;
    metro: number;
    note_amount: number;
    regional: number;
    cod: number;
    reason: string;
  };
  const revisitOverride = useMemo(() => {
    const map = new Map<string, RevisitShare[]>();
    const groups = new Map<string, Delivery[]>();
    for (const r of rows) {
      const gid = r.revisit_group_id;
      if (!gid) continue;
      const arr = groups.get(gid) || [];
      arr.push(r);
      groups.set(gid, arr);
    }
    for (const [, group] of groups) {
      const sorted = [...group].sort(
        (a, b) => Number(a.revisit_visit_no ?? 1) - Number(b.revisit_visit_no ?? 1),
      );
      const first = sorted[0];
      if (!first) continue;
      const baseMetro = num(first.metro_fee);
      const baseRegional = num(first.regional_fee);
      const baseNote = num(first.note_amount);
      const baseCod = num(first.cod_amount);
      const useMetro = baseMetro >= baseRegional;
      const baseTotal = baseMetro + baseRegional;
      const firstLeader = first.leader1_id;
      const firstLeaderValid =
        !!firstLeader && !virtualIds.has(firstLeader);

      // 수기분배 우선
      const manualRaw = Array.isArray(first.revisit_manual_shares)
        ? (first.revisit_manual_shares as Array<{ leader_id?: string; amount?: number }>)
        : null;
      const manual = manualRaw
        ? manualRaw.filter(
            (m) => m && m.leader_id && !virtualIds.has(m.leader_id) && num(m.amount) > 0,
          )
        : null;

      // 2차+ 행은 override = [] (정산에서 빠짐 — 모든 금액은 1차 행 override에 합쳐 표시)
      for (let i = 1; i < sorted.length; i++) {
        map.set(sorted[i].id, []);
      }

      if (manual && manual.length > 0) {
        const shares: RevisitShare[] = manual.map((m) => ({
          leader_id: m.leader_id as string,
          metro: useMetro ? num(m.amount) : 0,
          note_amount: 0,
          regional: useMetro ? 0 : num(m.amount),
          cod: 0,
          reason: "재방문 수기분배",
        }));
        if (firstLeaderValid && (baseNote !== 0 || baseCod !== 0)) {
          shares.push({
            leader_id: firstLeader as string,
            metro: 0,
            note_amount: baseNote,
            regional: 0,
            cod: baseCod,
            reason: "재방문 비고/착불(1차 팀장1)",
          });
        }
        map.set(first.id, shares);
        continue;
      }

      if (!firstLeaderValid) {
        map.set(first.id, []);
        continue;
      }

      // 자동 분배
      let assignedToSecondary = 0;
      const shares: RevisitShare[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const sec = sorted[i];
        const secLeader = sec.leader1_id;
        if (!secLeader || virtualIds.has(secLeader)) continue;
        if (secLeader === firstLeader) continue; // 동일 팀장 → 차감 없음
        const secAmt = num(sec.metro_fee) + num(sec.note_amount) + num(sec.regional_fee);
        if (secAmt <= 0) continue;
        const capped = Math.min(secAmt, Math.max(0, baseTotal - assignedToSecondary));
        if (capped <= 0) continue;
        assignedToSecondary += capped;
        shares.push({
          leader_id: secLeader,
          metro: useMetro ? capped : 0,
          note_amount: 0,
          regional: useMetro ? 0 : capped,
          cod: 0,
          reason: "재방문 2차 분배",
        });
      }
      const firstRemaining = Math.max(0, baseTotal - assignedToSecondary);
      shares.push({
        leader_id: firstLeader as string,
        metro: useMetro ? firstRemaining : 0,
        note_amount: baseNote,
        regional: useMetro ? 0 : firstRemaining,
        cod: baseCod,
        reason: assignedToSecondary > 0 ? "재방문 1차(2차분 차감)" : "재방문 1차 전액",
      });
      map.set(first.id, shares);
    }
    return map;
  }, [rows, virtualIds]);

  const isHyungjuDongseokLeader = (lid: string): boolean => lid === shindongseokId || lid === ganghyungjuId;
  const commonDefaultAmountFor = (lid: string, cd: CommonDeduction): number => {
    // 강형주/신동석은 한 팀 재분배 대상이므로 쓰레기비용 공통공제 50,000원을 기본 고정하지 않는다.
    if (isHyungjuDongseokLeader(lid) && isTrashDeductionLabel(cd.label)) return 0;
    return num(cd.amount);
  };

  /** 원본 배분(재분배 전) 기준 한 팀장의 합계. basis="raw"일 때 사용. */
  const rawTotalsFor = (lid: string) => {
    let metro = 0, noteAmt = 0, regional = 0, cod = 0, count = 0;
    rows.forEach((r) => {
      if (isLeaderSettlementExcludedItem(r.item) || isVirtualSettlementRow(r, virtualIds)) return;
      // 재방문 그룹은 override 기준으로 계산 (raw에서도 1차 청구 한도 내에서 분배)
      const ov = revisitOverride.get(r.id);
      if (ov !== undefined) {
        if (ov.length === 0) return;
        const mine = ov.filter((s) => s.leader_id === lid);
        if (mine.length === 0) return;
        let m = 0, n = 0, rg = 0, c = 0;
        mine.forEach((s) => { m += s.metro; n += s.note_amount; rg += s.regional; c += s.cod; });
        metro += m; noteAmt += n; regional += rg; cod += c;
        count += 1;
        return;
      }
      const shares = allocateRow({
        leader1_id: r.leader1_id, leader2_id: r.leader2_id, leader3_id: r.leader3_id,
        split_type: r.split_type, two_person: r.two_person,
        metro_fee: num(r.metro_fee), note_amount: num(r.note_amount),
        regional_fee: num(r.regional_fee), cod_amount: num(r.cod_amount),
        virtual_leader_id: r.virtual_leader_id ?? null,
      }, { virtualIds }); // 재분배는 건너뛰되 가상기사 입력은 제외
      const s = shares.find((x) => x.leader_id === lid);
      if (!s) return;
      metro += s.metro; noteAmt += s.note_amount; regional += s.regional; cod += s.cod;
      count += 1;
    });
    const total = metro + noteAmt + regional;
    const leader = leadersById.get(lid);
    const fees = leader
      ? feeForShare({ metro, regional }, { metro: num(leader.fee_rate_metro), regional: num(leader.fee_rate_regional) })
      : 0;
    return { count, total, cod, fees };
  };

  const activeCommonDeductions = useMemo(() => {
    const unique = new Map<string, CommonDeduction>();
    commonDeductions
      .filter((c) => c.active && (c.label || "").trim())
      .forEach((c) => {
        const key = normalizeDeductionLabel(c.label || "");
        if (!unique.has(key)) unique.set(key, c);
      });
    return Array.from(unique.values());
  }, [commonDeductions]);

  /**
   * 팀장+기간에 대한 공통공제 항목별 실제 적용금액.
   * - 단일 보름: 오버라이드 있으면 오버라이드, 없으면 base. (1번)
   * - 월전체: 1~15일 + 16~말일 각각 한 번씩 합산 (보름별로 오버라이드 적용, 없으면 base).
   * 보름 단위로만 누적되므로 배송건수가 늘어도 절대 중복 차감되지 않음.
   */
  const effectiveCommonAmount = (leaderId: string, cd: CommonDeduction): number => {
    let total = 0;
    for (const k of commonPeriodKeys) {
      const ov = commonOverrides.find(
        (o) => o.leader_id === leaderId && o.common_deduction_id === cd.id && o.period_key === k,
      );
      total += ov ? num(ov.amount) : commonDefaultAmountFor(leaderId, cd);
    }
    return total;
  };

  /** 팀장 공통공제 합계 (오버라이드 반영). */
  const commonTotalFor = (leaderId: string): number =>
    activeCommonDeductions.reduce((s, cd) => s + effectiveCommonAmount(leaderId, cd), 0);

  /**
   * 팀장별 자동 쓰레기비용 — team_leaders.trash_cost 를 보름 단위로 1번씩 자동 차감.
   * 1~15일 / 16~말일: 1번, 월전체: 2번, 전체기간: 1번.
   * 모든 팀장이 동일한 common_deductions 값에 종속되지 않고, 팀장별 trash_cost 가
   * 0보다 크면 무조건 자동 적용된다. 누락 팀장 없이 100% 적용 보장.
   */
  const trashCostAutoFor = (leaderId: string): number => {
    const lead = leadersById.get(leaderId);
    const base = num(lead?.trash_cost);
    if (base <= 0) return 0;
    return base * commonPeriodKeys.length;
  };

  const individualTotalFor = (lid: string): number =>
    periodDeductions
      .filter((d) => d.leader_id === lid)
      .reduce((s, d) => s + (num(d.amount) > 0 && (d.label || "").trim() ? num(d.amount) : 0), 0);

  /** 정산대상 팀장 목록: 활성 + 다른 팀장에게 정산귀속 안 된 팀장 */
  const settlingLeaders = useMemo(
    () => leaders.filter(
      (l) => l.active && !l.is_rejected && !l.is_virtual && !l.settle_to_id && (l.settle_status ?? "included") !== "excluded",
    ),
    [leaders],
  );

  // 자동검증 (내부 관점)
  const audit = useMemo(
    () => auditDeliveries({
      deliveries: settlementRows as any,
      companies,
      leaders,
      mode: "internal",
    }),
    [settlementRows, companies, leaders],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  useArrowKeyNav(rootRef);

  /** leaderId(정산기사) → 합산 대상 ID 집합 (본인 + 본인에게 settle_to인 팀장들) */
  const targetSetFor = (lid: string): Set<string> => {
    const s = new Set<string>([lid]);
    leaders.forEach((l) => { if (l.settle_to_id === lid) s.add(l.id); });
    return s;
  };

  /** 한 팀장(정산기사)에 귀속되는 행 추출 */
  const rowsForSettling = (lid: string): Delivery[] => {
    // 분배 결과(allocateRow) 기준으로 포함 여부를 판단.
    // 강형주/신동석 재분배로 인해 raw 팀장 ID에는 없어도 share에 잡히는 경우를 포함시킴.
    return rows.filter((r) => shareForSettling(r, lid) !== null);
  };

  /**
   * 행 1건을 정산기사 ID별로 분배. 분할/2인배송/일반 규칙 적용 후
   * 각 share의 leader_id를 settle_to_id로 redirect하여 정산기사에 귀속.
   */
  const shareForSettling = (r: Delivery, settlingLid: string): {
    metro: number; noteAmt: number; regional: number; cod: number; count: number;
    weight: number; reasons: string[];
  } | null => {
    if (isLeaderSettlementExcludedItem(r.item) || isVirtualSettlementRow(r, virtualIds)) return null;
    const targets = targetSetFor(settlingLid);
    // 재방문 override가 있으면 그 결과를 사용 (allocateRow 건너뜀)
    const ov = revisitOverride.get(r.id);
    if (ov !== undefined) {
      if (ov.length === 0) return null;
      let metro = 0, noteAmt = 0, regional = 0, cod = 0;
      const reasons: string[] = [];
      ov.forEach((s) => {
        if (!targets.has(s.leader_id)) return;
        metro += s.metro; noteAmt += s.note_amount;
        regional += s.regional; cod += s.cod;
        if (s.reason) reasons.push(s.reason);
      });
      if (metro === 0 && noteAmt === 0 && regional === 0 && cod === 0) return null;
      return { metro, noteAmt, regional, cod, count: 1, weight: 1, reasons };
    }
    const shares = allocateRow({
      leader1_id: r.leader1_id, leader2_id: r.leader2_id, leader3_id: r.leader3_id,
      split_type: r.split_type, two_person: r.two_person,
      metro_fee: num(r.metro_fee), note_amount: num(r.note_amount),
      regional_fee: num(r.regional_fee), cod_amount: num(r.cod_amount),
      virtual_leader_id: r.virtual_leader_id ?? null,
    }, sdsOpts);
    let metro = 0, noteAmt = 0, regional = 0, cod = 0, count = 0, weight = 0;
    const reasons: string[] = [];
    shares.forEach((s) => {
      if (!targets.has(s.leader_id)) return;
      metro += s.metro; noteAmt += s.note_amount;
      regional += s.regional; cod += s.cod;
      count += s.count; weight += s.weight;
      if (s.reason) reasons.push(s.reason);
    });
    if (count === 0) return null;
    // 같은 행에서 한 정산기사에게 중복 카운트되지 않도록 1로 고정
    return { metro, noteAmt, regional, cod, count: 1, weight, reasons };
  };

  /** 건별 수수료 (해당 정산기사 몫만). 비고금액은 수수료 제외. */
  const feeForRowSettling = (r: Delivery, settlingLid: string): number => {
    const share = shareForSettling(r, settlingLid);
    if (!share) return 0;
    const leader = leadersById.get(settlingLid);
    if (!leader) return 0;
    // 팀장별 수수료율 기준. 비고금액은 feeForShare 내부에서 제외된다.
    return feeForShare(
      { metro: share.metro, regional: share.regional },
      { metro: num(leader.fee_rate_metro), regional: num(leader.fee_rate_regional) },
    );
  };

  // ===== 마스터 목록 집계 =====
  const masterRows = useMemo(() => {
    return settlingLeaders.map((l) => {
      let metro = 0, noteAmt = 0, regional = 0, cod = 0, fees = 0, count = 0;
      rows.forEach((r) => {
        const share = shareForSettling(r, l.id);
        if (!share) return;
        metro += share.metro; noteAmt += share.noteAmt;
        regional += share.regional; cod += share.cod;
        count += share.count;
        fees += feeForRowSettling(r, l.id);
      });
      const total = metro + noteAmt + regional;
      const afterFees = total - fees;
      const indiv = individualTotalFor(l.id);
      // 쓰레기비용/공통공제는 배송건수와 무관하게 팀장 × 보름 단위로 자동 차감
      // (1~15일/16~말일=1회, 월전체=2회). 배송이 없어도 해당 팀장 공제란에 표시되어야 한다.
      const common = commonTotalFor(l.id) + trashCostAutoFor(l.id);
      const deduction = common + indiv;
      // 정산금은 음수 불가 — HQ 화면과 동일하게 0으로 클램프
      const net = Math.max(0, afterFees - cod - deduction);
      return {
        leader: l,
        count,
        metro, noteAmt, regional, cod,
        total,
        fees, afterFees, common, indiv, deduction, net,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlingLeaders, rows, leaders, activeCommonDeductions, commonOverrides, periodDeductions, commonKeysJoined]);

  const periodLabel =
    period === "all" ? "전체 기간" :
    period === "first" ? `${month} 1~15일` :
    period === "second" ? `${month} 16~말일` :
    `${month} 월전체`;

  // 상단 요약바: 정산귀속/팀 재분배가 모두 반영된 masterRows 기준 합계
  const topSummary = useMemo(() => {
    let totalCount = 0, totalCod = 0;
    masterRows.forEach((m) => {
      totalCount += m.count;
      totalCod += m.cod;
    });
    // 총배송비 = 업체정산 화면과 100% 동일하게 맞추기 위한 통합 헬퍼
    //   (적재비 제외 + 가상기사 단독 행 제외 + 재방문 1차만)
    const companyTotalFee = totalUnifiedDeliveryFee(rows, virtualIds);
    const totalFee = companyTotalFee;
    // 업체청구금액 = 실제로 각 업체에 청구된 금액의 합 (재방문 2차+/적재 제외 행 제외,
    //   미수금 - 착불 상계 + 부가세). 정산용 내부 계산값(totalLeaderSettlementDeliveryFee)과 분리.
    const billedByCompany = computeCompanyBilledByCompany(rows, companies, virtualIds);
    const actualCompanyBilledTotal = Array.from(billedByCompany.values())
      .reduce((s, v) => s + (v.billed || 0), 0);
    return {
      totalLeaders: masterRows.length,
      totalCount,
      totalCod,
      totalFee,
      companyTotalFee,
      actualCompanyBilledTotal,
      billedByCompany,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterRows, rows, companies]);

  // 업체정산 ↔ 팀장정산 총배송비 100% 일치 자동검증 (저장/재생성·필터 변경 시마다)
  const totalFeeCheck = useMemo(
    () => crossCheckTotalFee(rows, virtualIds),
    [rows, virtualIds],
  );

  // 업체청구금액(실제) 100% 추적: 업체정산서 청구금액과 100% 일치하는지 업체별로 검증
  const companyBilledCheck = useMemo(() => {
    const stmtCompanies = companies.map((c) => ({
      ...c,
      fee_rate_metro: 0,
      fee_rate_regional: 0,
      account_number: null,
      has_cod: true,
    })) as unknown as Parameters<typeof crossCheckCompanyBilled>[1];
    const stmtLeaders = leaders as unknown as Parameters<typeof crossCheckCompanyBilled>[2];
    const stmtDeliveries = rows as unknown as Parameters<typeof crossCheckCompanyBilled>[0];
    return crossCheckCompanyBilled(stmtDeliveries, stmtCompanies, stmtLeaders, period, virtualIds);
  }, [rows, companies, leaders, period, virtualIds]);
  const lastWarnedDiffRef = useRef<number | null>(null);

  // 총배송비(정산용) vs 업체청구금액(실제) 차이의 100% 원인 분해
  const totalVsBilled = useMemo(
    () => crossCheckTotalVsBilled(rows, companies, virtualIds),
    [rows, companies, virtualIds],
  );
  useEffect(() => {
    if (!totalFeeCheck.ok && lastWarnedDiffRef.current !== totalFeeCheck.diff) {
      toast.error(totalFeeCheck.message ?? "총배송비 검증 실패");
      lastWarnedDiffRef.current = totalFeeCheck.diff;
    } else if (totalFeeCheck.ok) {
      lastWarnedDiffRef.current = null;
    }
  }, [totalFeeCheck]);

  // ===== 헤더-셀 컬럼 위치 검증 (개발용) =====
  useEffect(() => {
    if (leaderId) { setLeaderColAlignError(false); return; }
    const t = window.setTimeout(() => {
      const table = document.querySelector<HTMLTableElement>(
        "[data-testid='leader-summary-table']",
      );
      if (!table) { setLeaderColAlignError(false); return; }
      const headCount = table.querySelectorAll("thead tr th").length;
      const rows = table.querySelectorAll("tbody tr");
      let bad = headCount !== LEADER_COLUMNS.length;
      rows.forEach((tr) => {
        const tds = tr.querySelectorAll("td");
        if (tds.length === 1) return; // colspan 빈상태 행
        if (tds.length !== headCount) bad = true;
      });
      setLeaderColAlignError(bad);
    }, 0);
    return () => window.clearTimeout(t);
  }, [masterRows, leaderId]);

  // ===== 상세 모드 =====
  const detailLeader = leaderId ? leadersById.get(leaderId) : undefined;
  const detailRows = useMemo(
    () => {
      const list = leaderId ? rowsForSettling(leaderId) : [];
      return [...list].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leaderId, rows, leaders],
  );
  const mergedFrom = useMemo(
    () => (leaderId ? leaders.filter((l) => l.settle_to_id === leaderId) : []),
    [leaders, leaderId],
  );
  const mergedIdSet = useMemo(() => new Set(mergedFrom.map((l) => l.id)), [mergedFrom]);
  const mergedSourceForRow = (r: Delivery): Leader | null => {
    const ids = [r.leader1_id, r.leader2_id, r.leader3_id].filter(Boolean) as string[];
    const src = ids.find((id) => mergedIdSet.has(id));
    return src ? (leadersById.get(src) || null) : null;
  };

  const detailCalc = useMemo(() => {
    let metro = 0, noteAmt = 0, regional = 0, cod = 0, fees = 0;
    let mergedTotal = 0, mergedCount = 0, count = 0;
    detailRows.forEach((r) => {
      if (!leaderId) return;
      const share = shareForSettling(r, leaderId);
      if (!share) return;
      metro += share.metro; noteAmt += share.noteAmt;
      regional += share.regional; cod += share.cod;
      count += share.count;
      fees += feeForRowSettling(r, leaderId);
      if (mergedSourceForRow(r)) {
        mergedTotal += share.metro + share.noteAmt + share.regional;
        mergedCount += 1;
      }
    });
    const total = metro + noteAmt + regional;
    const afterFees = total - fees;
    const indivTotal = detailDeductions.reduce(
      (s, d) => s + (num(d.amount) > 0 && (d.label || "").trim() ? num(d.amount) : 0),
      0,
    );
    // 상세 공통공제: 팀장 × 표시기간당 1번만 합산. 월전체만 보름 2개 합산.
    // 배송건수와 무관하게 해당 팀장 공제란에 표시한다.
    const commonBase = activeCommonDeductions.reduce((s, cd) => {
      const cdTotal = commonPeriodKeys.reduce((periodSum, pKey) => {
        const editKey = `${cd.id}__${pKey}`;
        const edited = detailCommonEdits[editKey];
        if (typeof edited === "number") return periodSum + edited;
        const ov = detailLeader
          ? commonOverrides.find(
              (o) => o.leader_id === detailLeader.id && o.common_deduction_id === cd.id && o.period_key === pKey,
            )
          : undefined;
        const fallback = detailLeader ? commonDefaultAmountFor(detailLeader.id, cd) : num(cd.amount);
        return periodSum + (ov ? num(ov.amount) : fallback);
      }, 0);
      return s + cdTotal;
    }, 0);
    // 팀장별 쓰레기비용 자동 차감 (보름 단위 × 보름수). 배송건수와 무관하게 적용.
    const trashAuto = !detailLeader ? 0 : trashCostAutoFor(detailLeader.id);
    const commonTotal = commonBase + trashAuto;
    const deduction = commonTotal + indivTotal;
    // 정산금은 음수 불가 — 마스터/저장 화면과 동일하게 0 으로 클램프
    const net = Math.max(0, afterFees - cod - deduction);
    return { metro, noteAmt, regional, cod, total, fees, afterFees, deduction, net, mergedTotal, mergedCount, indivTotal, commonTotal, count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRows, detailLeader, mergedIdSet, detailDeductions, detailCommonEdits, activeCommonDeductions, commonOverrides, commonKeysJoined]);

  // 상세화면 업체별 요약 (기준서: 업체명/건수/수도권/비고/지방/실지급배송비/착불/수수료/계산후 지급금액)
  const detailByCompany = useMemo(() => {
    if (!leaderId) return [] as Array<{
      company: string; companyId?: string; count: number; metro: number; noteAmt: number; regional: number;
      total: number; cod: number; fees: number; afterFees: number;
      // 실제 업체 청구금액 (VAT 포함) — 정산용 계산값과 분리
      actualBilled: number;
    }>;
    const map = new Map<string, {
      company: string; companyId?: string; count: number; metro: number; noteAmt: number; regional: number;
      cod: number; fees: number;
    }>();
    detailRows.forEach((r) => {
      const share = shareForSettling(r, leaderId);
      if (!share) return;
      const key = r.company_name || "(미지정)";
      const cur = map.get(key) || { company: key, companyId: r.company_id ?? undefined, count: 0, metro: 0, noteAmt: 0, regional: 0, cod: 0, fees: 0 };
      cur.count += share.count;
      cur.metro += share.metro;
      cur.noteAmt += share.noteAmt;
      cur.regional += share.regional;
      cur.cod += share.cod;
      cur.fees += feeForRowSettling(r, leaderId);
      map.set(key, cur);
    });
    const billedMap = topSummary.billedByCompany;
    return Array.from(map.values())
      .map((v) => {
        const total = v.metro + v.noteAmt + v.regional;
        const billed = v.companyId ? (billedMap.get(v.companyId)?.billed ?? 0) : 0;
        return { ...v, total, afterFees: total - v.fees, actualBilled: billed };
      })
      .sort((a, b) => b.actualBilled - a.actualBilled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRows, leaderId, leaders, topSummary.billedByCompany]);

  // 상세 진입 시 개별공제 로드
  useEffect(() => {
    if (!leaderId) { setDetailDeductions([]); setDetailCommonEdits({}); return; }
    (async () => {
      const { data } = await supabase
        .from("leader_period_deductions")
        .select("*")
        .eq("leader_id", leaderId)
        .eq("period_key", periodKey)
        .order("sort_order");
      setDetailDeductions((data as LeaderPeriodDeduction[]) || []);
    })();
    // 편집중 값 초기화 (저장된 override는 effective 함수에서 자동 적용)
    setDetailCommonEdits({});
  }, [leaderId, periodKey]);

  const addDetailDeduction = () => {
    setDetailDeductions((d) => [
      ...d,
      { id: `tmp-${Date.now()}-${Math.random()}`, leader_id: leaderId, period_key: periodKey, label: "", amount: 0, sort_order: d.length },
    ]);
  };
  const updateDetailDeduction = (id: string, patch: Partial<LeaderPeriodDeduction>) => {
    setDetailDeductions((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const removeDetailDeduction = (id: string) => {
    setDetailDeductions((d) => d.filter((x) => x.id !== id));
  };
  const saveDetailDeductions = async () => {
    if (!user || !leaderId) return;
    const validRows = detailDeductions.filter((d) => (d.label || "").trim() || num(d.amount) > 0);
    const totalAmt = validRows.reduce((s, d) => s + num(d.amount), 0);
    const leaderName = leaders.find((l: any) => l.id === leaderId)?.name || "팀장";
    const ok = await confirmSave({
      title: "개별 공제 저장 확인",
      summary: [
        { label: "팀장", value: leaderName },
        { label: "기간", value: periodKey },
        { label: "항목 수", value: `${validRows.length}건` },
        { label: "총액", value: `${num(totalAmt).toLocaleString()}원` },
      ],
    });
    if (!ok) return;
    setSavingDeductions(true);
    // 단순화: 해당 (leader, period)의 모든 행 삭제 후 비어있지 않은 행만 재삽입
    await supabase
      .from("leader_period_deductions")
      .delete()
      .eq("leader_id", leaderId)
      .eq("period_key", periodKey);
    const toInsert = detailDeductions
      .filter((d) => (d.label || "").trim() || num(d.amount) > 0)
      .map((d, i) => ({
        user_id: user.id,
        leader_id: leaderId,
        period_key: periodKey,
        label: d.label || "",
        amount: num(d.amount),
        sort_order: i,
      }));
    if (toInsert.length > 0) {
      const { error } = await supabase.from("leader_period_deductions").insert(toInsert);
      if (error) { toast.error("저장 실패: " + error.message); setSavingDeductions(false); return; }
    }
    // 재로딩
    const { data } = await supabase
      .from("leader_period_deductions")
      .select("*")
      .eq("leader_id", leaderId)
      .eq("period_key", periodKey)
      .order("sort_order");
    setDetailDeductions((data as LeaderPeriodDeduction[]) || []);
    // 마스터 합계용 캐시도 갱신
    const { data: all } = await supabase
      .from("leader_period_deductions")
      .select("*")
      .eq("period_key", periodKey);
    setPeriodDeductions((all as LeaderPeriodDeduction[]) || []);
    setSavingDeductions(false);
    toast.success("개별 공제 저장 완료");
  };

  const reloadCommonOverrides = async () => {
    const { data } = await supabase
      .from("leader_common_overrides")
      .select("*")
      .in("period_key", commonPeriodKeys);
    setCommonOverrides((data as LeaderCommonOverride[]) || []);
  };

  /** 편집 중인 공통공제 값 저장 (upsert). base와 동일하면 오버라이드 제거. */
  const saveDetailCommon = async () => {
    if (!user || !leaderId) return;
    const entries = Object.entries(detailCommonEdits);
    if (entries.length === 0) return;
    const ok = await confirmSave({
      title: "공통 공제 수정값 저장 확인",
      summary: [
        { label: "수정 항목 수", value: `${entries.length}건` },
      ],
    });
    if (!ok) return;
    setSavingCommon(true);
    for (const [editKey, amount] of entries) {
      // editKey 형식: `${cdId}__${periodKey}`
      const [cdId, pKey] = editKey.split("__");
      if (!cdId || !pKey) continue;
      const cd = commonDeductions.find((c) => c.id === cdId);
      if (!cd) continue;
      const base = commonDefaultAmountFor(leaderId, cd);
      if (Number(amount) === base) {
        await supabase
          .from("leader_common_overrides")
          .delete()
          .eq("leader_id", leaderId)
          .eq("period_key", pKey)
          .eq("common_deduction_id", cdId);
      } else {
        const { error } = await supabase
          .from("leader_common_overrides")
          .upsert(
            {
              user_id: user.id,
              leader_id: leaderId,
              period_key: pKey,
              common_deduction_id: cdId,
              amount: Number(amount) || 0,
            },
            { onConflict: "leader_id,period_key,common_deduction_id" },
          );
        if (error) { toast.error("공통공제 저장 실패: " + error.message); setSavingCommon(false); return; }
      }
    }
    setDetailCommonEdits({});
    await reloadCommonOverrides();
    setSavingCommon(false);
    toast.success("공통 공제 수정값 저장 완료");
  };

  /** 기본값으로 되돌리기: 저장된 오버라이드 삭제 + 편집 상태도 base로 */
  const resetCommonOverride = async (cdId: string, pKey: string, _base: number) => {
    if (!user || !leaderId) return;
    await supabase
      .from("leader_common_overrides")
      .delete()
      .eq("leader_id", leaderId)
      .eq("period_key", pKey)
      .eq("common_deduction_id", cdId);
    const editKey = `${cdId}__${pKey}`;
    setDetailCommonEdits((m) => {
      const { [editKey]: _omit, ...rest } = m;
      return rest;
    });
    await reloadCommonOverrides();
    toast.success("기본값으로 되돌렸습니다");
  };

  return (
    <div className="space-y-4" ref={rootRef}>
      {saveConfirmDialog}
      <div className="flex flex-wrap items-center gap-2">
        {leaderId && (
          <Button variant="outline" size="sm" onClick={() => setLeaderId("")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 전체 팀장 목록
          </Button>
        )}
        <h1 className="text-2xl font-bold flex-1 min-w-full sm:min-w-0 whitespace-nowrap">팀장정산</h1>
        <PrintButton documentTitle={`팀장정산_${month}`} />
        <input
          type="month" value={month}
          onChange={(e) => { setMonth(e.target.value); }}
          disabled={period === "all"} className="border rounded px-3 py-2"
        />
        <div className="flex gap-1">
          {([
            ["all", "전체"],
            ["first", "1~15일"],
            ["second", "16~말일"],
            ["month", "월전체"],
          ] as [Period, string][]).map(([p, label]) => (
            <Button key={p} size="sm" variant={period === p ? "default" : "outline"}
              onClick={() => { setPeriod(p); }}>
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 border rounded px-3 py-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">날짜 자동</span>
          <Switch checked={autoPeriod} onCheckedChange={toggleAutoPeriod} />
        </div>
      </div>

      <AuditBanner title="자동검증 (계산서·거부업체·제출문구)" result={audit} defaultOpen={!audit.ok} />

      <TotalFeeMismatchBanner result={totalFeeCheck} unifiedLabel="통합식" leaderLabel="팀장정산식" />

      <CompanyBilledMismatchBanner result={companyBilledCheck} />

      {!leaderId && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <LeaderSummaryCard label="총팀장수" value={topSummary.totalLeaders.toLocaleString()} />
          <LeaderSummaryCard label="총배송건수" value={topSummary.totalCount.toLocaleString()} />
          <LeaderSummaryCard label="총착불금액" value={fmt(topSummary.totalCod)} accent />
          <LeaderSummaryCard label="총배송비(정산용)" value={fmt(topSummary.totalFee)} bold />
          <LeaderSummaryCard label="업체청구금액(실제)" value={fmt(topSummary.actualCompanyBilledTotal)} bold red />
        </div>
      )}

      {!leaderId && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="text-sm text-muted-foreground">{periodLabel} 기준 · 팀장명 클릭 시 상세보기</div>
            <div className="flex items-center gap-2">
              <Input
                value={leaderSearch}
                onChange={(e) => setLeaderSearch(e.target.value)}
                placeholder="팀장명 검색 (별칭 가능)"
                className="h-8 w-56 text-xs"
              />
              {leaderSearch && (
                <Button size="sm" variant="ghost" onClick={() => setLeaderSearch("")}>지우기</Button>
              )}
            </div>
          </div>
          {leaderColAlignError && (
            <div className="mb-2 rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive font-medium">
              팀장정산 목록의 헤더와 데이터 컬럼 위치가 일치하지 않습니다.
            </div>
          )}
          <div className="w-full">
            <table
              data-testid="leader-summary-table"
              className="w-full text-sm num table-fixed border-collapse"
            >
              <colgroup>
                {LEADER_COLUMNS.map((c) => (
                  <col key={c.key} style={{ width: `${(c.width / LEADER_TABLE_MIN_WIDTH) * 100}%` }} />
                ))}
              </colgroup>
              <thead className="[&_tr]:border-b">
                <tr className="border-b">
                  {LEADER_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className="h-12 px-2 text-center align-middle font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {(() => {
                  const q = leaderSearch.trim().toLowerCase();
                  const visible = q
                    ? masterRows.filter((m) => {
                        const nm = (getDisplayName(m.leader, leaders) || "").toLowerCase();
                        const al = ((m.leader.aliases as string[] | undefined) || [])
                          .map((a) => (a || "").toLowerCase());
                        return nm.includes(q) || al.some((a) => a.includes(q));
                      })
                    : masterRows;
                  return visible.map((m) => {
                  const issuesInvoice = !!m.leader.issues_invoice;
                  // 부가세는 실지급액(net) 기준 10% — 정산서 저장본과 100% 동일
                  const vat = issuesInvoice ? Math.round(m.net * 0.1) : 0;
                  const totalWithVat = m.net + vat;
                  const cells: Record<LeaderColKey, React.ReactNode> = {
                    name: (
                      <button className="text-primary hover:underline font-medium">
                        {getDisplayName(m.leader, leaders)}
                      </button>
                    ),
                    count: m.count ? m.count.toLocaleString() : "-",
                    metro: fmt(m.metro),
                    note: fmt(m.noteAmt),
                    regional: fmt(m.regional),
                    cod: fmt(m.cod),
                    deduction: fmt(m.deduction),
                    total: (
                      <div className="flex flex-col leading-tight">
                        <span className="font-bold">{fmt(m.total)}</span>
                        {issuesInvoice && (
                          <span className="text-[11px] text-muted-foreground">
                            실지급+VAT {fmt(vat)} = <b className="text-primary">{fmt(totalWithVat)}</b>
                          </span>
                        )}
                      </div>
                    ),
                    afterFees: <span className="text-red-500 font-medium">{fmt(m.afterFees)}</span>,
                    detail: (
                      <span className="text-primary text-xs hover:underline">상세보기</span>
                    ),
                  };
                  return (
                    <tr
                      key={m.leader.id}
                      className="border-b transition-colors cursor-pointer hover:bg-muted/50"
                      onClick={() => setLeaderId(m.leader.id)}
                    >
                      {LEADER_COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className="p-2 align-middle text-center whitespace-nowrap"
                        >
                          {cells[c.key]}
                        </td>
                      ))}
                    </tr>
                  );
                });
                })()}
                {masterRows.length === 0 && (
                  <tr className="border-b">
                    <td
                      colSpan={LEADER_COLUMNS.length}
                      className="text-center text-muted-foreground py-6"
                    >
                      정산대상 팀장 없음
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {detailLeader && (
        <Card className="p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <h2 className="font-bold text-lg">{getDisplayName(detailLeader, leaders)}</h2>
            <span className="text-sm text-muted-foreground">{periodLabel}</span>
          </div>

          {mergedFrom.length > 0 && (
            <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
              <div className="font-semibold text-amber-800">
                {mergedFrom.map((l) => l.name).join(", ")} 정산합산 포함
              </div>
              <div className="text-amber-700 num">
                합산 건수: <b>{detailCalc.mergedCount}건</b> &nbsp;|&nbsp;
                합산 금액: <b>{fmt(detailCalc.mergedTotal)}</b>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 mb-4">
            {/* 좌측: 팀장 내역 */}
            <div>
              <h3 className="font-semibold text-sm mb-2">팀장 내역</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 num">
                <Stat label="배송건수" value={detailCalc.count} raw />
                <Stat label="수도권배송비" value={detailCalc.metro} />
                <Stat label="비고금액" value={detailCalc.noteAmt} />
                <Stat label="지방배송비" value={detailCalc.regional} />
                <Stat label="착불 합계" value={detailCalc.cod} />
                <Stat label="수수료 합계" value={detailCalc.fees} />
                <Stat label="계산후 지급금액" value={detailCalc.afterFees} />
                <Stat label="공제총액" value={detailCalc.deduction} />
                <Stat label="실지급액" value={detailCalc.net} highlight />
                {detailLeader.issues_invoice && (
                  <>
                    <Stat label="부가세 (10%)" value={Math.round(detailCalc.net * 0.1)} />
                    <Stat
                      label="부가세포함 총합"
                      value={detailCalc.net + Math.round(detailCalc.net * 0.1)}
                      highlight
                    />
                  </>
                )}
              </div>
            </div>
            {/* 우측: 배송한 업체 상위 7개 */}
            <div>
              <h3 className="font-semibold text-sm mb-2">배송한 업체 상위 7개</h3>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-sm num">
                  <thead className="bg-muted/40">
                    <tr className="border-b">
                      <th className="text-left px-2 py-2 font-medium text-muted-foreground">업체명</th>
                      <th className="text-center px-2 py-2 font-medium text-muted-foreground w-20">건수</th>
                      <th className="text-right px-2 py-2 font-medium text-muted-foreground w-32" title="실제 업체에 청구된 금액 (VAT 포함)">업체청구금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailByCompany.slice(0, 7).map((c) => (
                      <tr key={c.company} className="border-b last:border-0">
                        <td className="px-2 py-2 truncate max-w-[180px]">{c.company}</td>
                        <td className="px-2 py-2 text-center">{c.count.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right font-semibold">{fmt(c.actualBilled)}</td>
                      </tr>
                    ))}
                    {detailByCompany.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center text-muted-foreground py-4">데이터 없음</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <Card className="p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">공통 공제 ({periodLabel})</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm num font-semibold">{fmt(detailCalc.commonTotal)}</span>
                  <Button size="sm" onClick={saveDetailCommon} disabled={savingCommon || Object.keys(detailCommonEdits).length === 0}>
                    저장
                  </Button>
                </div>
              </div>
              {activeCommonDeductions.length === 0 && (
                <div className="text-sm text-muted-foreground">공통 공제 항목이 없습니다. 설정 &gt; 공통공제에서 추가하세요.</div>
              )}
              <div className="space-y-1">
                {activeCommonDeductions.flatMap((cd) =>
                  commonPeriodKeys.map((pKey) => {
                    const base = detailLeader ? commonDefaultAmountFor(detailLeader.id, cd) : num(cd.amount);
                    const ov = detailLeader
                      ? commonOverrides.find(
                          (o) => o.leader_id === detailLeader.id && o.common_deduction_id === cd.id && o.period_key === pKey,
                        )
                      : undefined;
                    const saved = ov ? num(ov.amount) : base;
                    const editKey = `${cd.id}__${pKey}`;
                    const edited = detailCommonEdits[editKey];
                    const current = typeof edited === "number" ? edited : saved;
                    const isCustom = typeof edited === "number" ? edited !== base : !!ov && saved !== base;
                    const periodLabelShort = pKey === "all"
                      ? "전체기간"
                      : pKey.endsWith("-first") ? "1~15일"
                      : pKey.endsWith("-second") ? "16~말일"
                      : pKey;
                    return (
                      <div key={editKey} className="flex gap-2 items-center">
                        <span className="flex-1 text-sm">
                          {cd.label}
                          <span className="ml-1 text-xs text-primary font-medium">[{periodLabelShort}]</span>
                          {isCustom && <span className="ml-1 text-xs text-amber-700">(수정됨)</span>}
                          <span className="ml-1 text-xs text-muted-foreground">기본 {fmt(base)}</span>
                        </span>
                        <Input
                          type="number"
                          className="h-8 w-32 text-right num"
                          value={current}
                          onChange={(e) =>
                            setDetailCommonEdits((m) => ({ ...m, [editKey]: Number(e.target.value) || 0 }))
                          }
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="기본값으로 되돌리기"
                          onClick={() => resetCommonOverride(cd.id, pKey, base)}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  }),
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                * 쓰레기비용 등 공통공제는 팀장 × 보름 기간당 1번만 적용됩니다 (배송건수 무관).
                {isMultiCommonPeriod
                  ? " 월전체에서는 1~15일과 16~말일이 각각 1번씩(총 2회) 표시되며 보름별로 따로 수정할 수 있습니다."
                  : ` 수정값은 해당 팀장/${periodKey}에만 저장됩니다.`}
              </div>
            </Card>

            <Card className="p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">개별 공제 ({periodLabel})</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm num font-semibold">{fmt(detailCalc.indivTotal)}</span>
                  <Button size="sm" variant="outline" onClick={addDetailDeduction} disabled={detailDeductions.length >= 10}>
                    <Plus className="h-3 w-3 mr-1" />추가
                  </Button>
                  <Button size="sm" onClick={saveDetailDeductions} disabled={savingDeductions}>저장</Button>
                </div>
              </div>
              <div className="space-y-1">
                {detailDeductions.map((d) => (
                  <div key={d.id} className="flex gap-2 items-center">
                    <Input
                      className="h-8 flex-1"
                      placeholder="공제내용 (예: 파손)"
                      value={d.label}
                      onChange={(e) => updateDetailDeduction(d.id, { label: e.target.value })}
                    />
                    <Input
                      type="number"
                      className="h-8 w-32 text-right num"
                      placeholder="0"
                      value={d.amount}
                      onChange={(e) => updateDetailDeduction(d.id, { amount: Number(e.target.value) || 0 })}
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeDetailDeduction(d.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {detailDeductions.length === 0 && (
                  <div className="text-sm text-muted-foreground">개별 공제 항목 없음. ‘추가’를 눌러 입력하세요.</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                * 입력 후 ‘저장’을 눌러야 반영됩니다. 해당 팀장/해당 정산기간({periodKey})에만 저장됩니다.
              </div>
            </Card>
          </div>

          <div className="overflow-x-auto">
            <Table className="text-xs num">
              <TableHeader>
                <TableRow>
                  <TableHead>날짜</TableHead>
                  <TableHead>업체</TableHead>
                  <TableHead>실제기사1</TableHead>
                  <TableHead>실제기사2</TableHead>
                  <TableHead>정산기사</TableHead>
                  <TableHead>고객명</TableHead>
                  <TableHead>배송지</TableHead>
                  <TableHead>품목</TableHead>
                  <TableHead>비고</TableHead>
                  <TableHead className="text-right">수도권배송비</TableHead>
                  <TableHead className="text-right">비고금액</TableHead>
                  <TableHead className="text-right">지방배송비</TableHead>
                  <TableHead className="text-right">착불</TableHead>
                  <TableHead className="text-right">실지급배송비</TableHead>
                  <TableHead>분할</TableHead>
                  <TableHead>2인배송</TableHead>
                  <TableHead className="text-right">건별 수수료</TableHead>
                  <TableHead className="text-right">건별 계산후 지급액</TableHead>
                  <TableHead className="text-right">건별 실지급액</TableHead>
                  <TableHead>정산처리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailRows.map((r) => {
                  const src = mergedSourceForRow(r);
                  const real1 = realLeaderIdFor(r, leadersById);
                  const real1Name = real1 ? (leadersById.get(real1)?.name || r.leader1_name) : r.leader1_name;
                  const real2Name = r.leader2_id
                    ? (leadersById.get(r.leader2_id)?.name || r.leader2_name)
                    : (r.leader2_name || r.virtual_leader_name || null);
                  const settleId = settlementLeaderIdFor(r, leadersById);
                  const settleName = settleId ? (leadersById.get(settleId)?.name || "-") : "-";
                  const share = leaderId ? shareForSettling(r, leaderId) : null;
                  const shareMetro = share?.metro ?? 0;
                  const shareNote = share?.noteAmt ?? 0;
                  const shareRegional = share?.regional ?? 0;
                  const shareCod = share?.cod ?? 0;
                  const totalFee = shareMetro + shareNote + shareRegional;
                  const fee = leaderId ? feeForRowSettling(r, leaderId) : 0;
                  const afterFee = totalFee - fee;
                  const isHalf = (share?.weight ?? 1) > 0 && (share?.weight ?? 1) < 1;
                  return (
                    <TableRow key={r.id} className={src ? "bg-amber-50 hover:bg-amber-100" : ""}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.company_name}</TableCell>
                      <TableCell>{real1Name || "-"}</TableCell>
                      <TableCell>
                        <div>{real2Name || "-"}</div>
                        {r.virtual_leader_name && !r.leader2_id && (
                          <div className="text-[10px] text-amber-700 font-medium">가상기사</div>
                        )}
                        {r.virtual_leader_name && r.leader2_id && (
                          <div className="text-[10px] text-muted-foreground">가상기사: {r.virtual_leader_name}</div>
                        )}
                      </TableCell>
                      <TableCell>{settleName}</TableCell>
                      <TableCell>{r.customer_name || "-"}</TableCell>
                      <TableCell>{r.region || "-"}</TableCell>
                      <TableCell className="max-w-[180px] whitespace-pre-wrap break-words">{r.item || "-"}</TableCell>
                      <TableCell className="max-w-[180px] whitespace-pre-wrap break-words">{r.note || "-"}</TableCell>
                      <TableCell className="text-right">{fmt(shareMetro)}</TableCell>
                      <TableCell className="text-right">{fmt(shareNote)}</TableCell>
                      <TableCell className="text-right">{fmt(shareRegional)}</TableCell>
                      <TableCell className="text-right">{fmt(shareCod)}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(totalFee)}</TableCell>
                      <TableCell>{r.split_type || "-"}</TableCell>
                      <TableCell>{r.two_person
                        ? <span className="inline-block px-2 py-0.5 rounded text-[11px] bg-blue-100 text-blue-800 font-medium">2인배송{isHalf ? " 50%" : ""}</span>
                        : (isHalf ? <span className="text-xs text-muted-foreground">분할 {Math.round((share?.weight ?? 0) * 100)}%</span> : "-")}
                      </TableCell>
                      <TableCell className="text-right">{fmt(fee)}</TableCell>
                      <TableCell className="text-right">{fmt(afterFee)}</TableCell>
                      <TableCell className="text-right">{fmt(afterFee - shareCod)}</TableCell>
                      <TableCell className={src ? "text-amber-800 font-medium" : "text-muted-foreground"}>
                        <div className="space-y-0.5">
                          <div>{src ? `${src.name} → ${detailLeader.name}` : "본인"}</div>
                          {share?.reasons?.length ? (
                            <div className="text-[11px] text-muted-foreground">
                              {Array.from(new Set(share.reasons)).join(" · ")}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {detailRows.length === 0 && (
                  <TableRow><TableCell colSpan={20} className="text-center text-muted-foreground py-6">데이터 없음</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4">
            <Button variant="outline" onClick={() => setLeaderId("")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> 전체 팀장 목록으로 돌아가기
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, highlight, raw }: { label: string; value: number; highlight?: boolean; raw?: boolean }) {
  return (
    <div className={`p-3 rounded border ${highlight ? "bg-red-50 border-red-200" : ""}`}>
      <div className={`text-xs ${highlight ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{label}</div>
      <div className={`text-xl font-bold ${highlight ? "text-red-600" : ""}`}>{raw ? value : fmt(value)}</div>
    </div>
  );
}

function LeaderSummaryCard({
  label, value, accent, bold, red,
}: { label: string; value: string; accent?: boolean; bold?: boolean; red?: boolean }) {
  return (
    <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50">
      <div className="text-xs text-emerald-900/70">{label}</div>
      <div
        className={`mt-1 num ${bold ? "text-2xl font-extrabold" : "text-2xl font-bold"} ${
          red ? "text-red-600" : accent ? "text-orange-600" : "text-emerald-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

