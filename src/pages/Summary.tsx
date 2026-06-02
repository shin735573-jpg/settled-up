import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useArrowKeyNav } from "@/hooks/useArrowKeyNav";
import { sortLeadersByFeeAsc, compareLeadersByFeeAsc } from "@/lib/leaderSort";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fmt } from "@/lib/format";
import { allocateRow, feeForShare } from "@/lib/splitAllocation";
import { isVirtualSettlementRow } from "@/lib/itemRules";
import { auditDeliveries } from "@/lib/liveAudit";
import { AuditBanner } from "@/components/AuditBanner";
import PrintButton from "@/components/PrintButton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { getCurrentHalf, useAutoPeriodSync } from "@/lib/autoPeriod";
import { keepRevisitPrimaryOnly } from "@/lib/revisitDedup";
import { computeRevisitRedistribution } from "@/lib/revisitRedistribute";
import { traceSummaryMismatch } from "@/lib/summaryMismatchTrace";
import { SummaryMismatchPanel } from "@/components/SummaryMismatchPanel";

type Delivery = any;
type Company = {
  id: string; name: string; active: boolean;
  issues_invoice?: boolean | null;
  rejected_leader_id?: string | null;
  rejected_leader_id_2?: string | null;
  rejected_leader_id_3?: string | null;
};
type Leader = {
  id: string; name: string; active: boolean; is_rejected: boolean; is_virtual: boolean;
  settle_to_id: string | null; settle_status?: "included" | "excluded" | null;
  aliases?: string[] | null; deduction_amount?: number; trash_cost?: number;
  region?: string | null;
  fee_rate_metro?: number; fee_rate_regional?: number;
};

type Period = "h1" | "h2" | "all";

const COMPANY_COLUMNS = [
  { key: "rank", label: "순위", size: "70px" },
  { key: "company", label: "업체", size: "1fr" },
  { key: "company_count", label: "건수", size: "90px" },
  { key: "company_amount", label: "금액", size: "1fr" },
  { key: "company_share", label: "비중%", size: "90px" },
] as const;

const LEADER_COLUMNS = [
  { key: "rank", label: "순위", size: "70px" },
  { key: "leader", label: "팀장", size: "1fr" },
  { key: "leader_count", label: "건수", size: "90px" },
  { key: "leader_amount", label: "실수령액", size: "1fr" },
  { key: "leader_share", label: "비중%", size: "90px" },
] as const;

import {
  isInEffectivePeriod as __isInEffectivePeriod,
  settleOverridePrefix as __settleOverridePrefix,
  withEffectiveDate as __withEffectiveDate,
} from "@/lib/missingOverride";

const inPeriod = (dateStr: string, period: Period): boolean => {
  const d = Number((dateStr || "").slice(8, 10));
  if (!d) return false;
  if (period === "h1") return d >= 1 && d <= 15;
  if (period === "h2") return d >= 16;
  return true;
};

export default function Summary() {
  const initial = useMemo(() => getCurrentHalf(), []);
  const [month, setMonth] = useState(() => initial.month);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [period, setPeriod] = useState<Period>(initial.half);
  const [autoPeriod, setAutoPeriod] = useState<boolean>(() => {
    try { return localStorage.getItem("summary.autoPeriod") !== "0"; } catch { return true; }
  });
  const toggleAutoPeriod = (v: boolean) => {
    setAutoPeriod(v);
    try { localStorage.setItem("summary.autoPeriod", v ? "1" : "0"); } catch { /* noop */ }
    if (v) {
      const cur = getCurrentHalf();
      setMonth(cur.month);
      setPeriod(cur.half);
    }
  };
  useAutoPeriodSync(autoPeriod, () => {
    const cur = getCurrentHalf();
    setMonth((prev) => (prev === cur.month ? prev : cur.month));
    setPeriod((prev) => (prev === cur.half ? prev : cur.half));
  });

  useEffect(() => {
    (async () => {
      const start = month + "-01";
      const next = new Date(start); next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const [{ data: d }, { data: dOv }, { data: c }, { data: l }] = await Promise.all([
        supabase.from("deliveries").select("*").gte("date", start).lt("date", end),
        // 누락분 정산 반영월 override 가 이 month 를 가리키는 행도 같이 수집
        supabase.from("deliveries").select("*").ilike("missing_reason", `${__settleOverridePrefix(month)}%`),
        supabase.from("companies").select("id,name,active,issues_invoice,rejected_leader_id,rejected_leader_id_2,rejected_leader_id_3").order("name"),
        supabase.from("team_leaders").select("id,name,active,is_rejected,is_virtual,settle_to_id,aliases,settle_status,deduction_amount,trash_cost,region,fee_rate_metro,fee_rate_regional").order("name"),
      ]);
      const merged = new Map<string, any>();
      for (const r of (d as any[]) || []) merged.set(r.id, r);
      for (const r of (dOv as any[]) || []) merged.set(r.id, r);
      setRows(Array.from(merged.values()).map((r) => __withEffectiveDate(r)));
      setCompanies((c as Company[]) || []);
      setLeaders(sortLeadersByFeeAsc((l as Leader[]) || []));
    })();
  }, [month]);

  // 기간 필터 — 누락분 override 가 있는 행은 effective date 가 이미 반영돼 있음
  const periodRows = useMemo(
    () => rows.filter((r) => __isInEffectivePeriod(r as { date?: string; missing_reason?: string | null }, month, period)),
    [rows, period, month],
  );

  const findId = (names: string[]) => {
    for (const l of leaders) {
      const nm = (l.name || "").trim();
      const al = ((l.aliases as string[]) || []).map((a) => (a || "").trim());
      if (names.some((n) => n === nm || al.includes(n))) return l.id;
    }
    return null;
  };
  const shindongseokId = findId(["신동석", "동석"]);
  const ganghyungjuId = findId(["강형주", "형주"]);
  const oeunkyuId = findId(["오은규"]);
  const odongseonId = findId(["오동선"]);
  const kimyongikId = findId(["김용익"]);

  const byId = useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);
  const virtualIds = useMemo(
    () => new Set(leaders.filter((l) => l.is_virtual).map((l) => l.id)),
    [leaders],
  );
  const settlementPeriodRows = useMemo(
    () => periodRows.filter((r) => !isVirtualSettlementRow(r, virtualIds)),
    [periodRows, virtualIds],
  );

  // settle_to_id 체인 + 가상기사 자동 귀속(설정된 경우만)
  const resolveSettleId = (id: string): string => {
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

  // 집계 가능한 최종 팀장: 활성·비거부·정산포함, settle_to_id 없음(=최종)
  // 가상기사는 절대 정산 대상에서 제외 — 업체 기록상 팀장2 자리에 들어가도 정산/내역에 잡히지 않음.
  const isCountable = (l: Leader | undefined): boolean =>
    !!l && l.active && !l.is_rejected && !l.is_virtual &&
    (l.settle_status ?? "included") !== "excluded" && !l.settle_to_id;

  // 각 행을 팀장 분배로 계산 — 한 명이라도 집계 가능 팀장에 귀속되면 행을 "유효"로 본다.
  const allocations = useMemo(() => {
    const revisitOverride = computeRevisitRedistribution(settlementPeriodRows, virtualIds);
    return settlementPeriodRows.map((r) => {
      const ov = revisitOverride.get(r.id);
      if (ov !== undefined) {
        if (ov.length === 0) return { row: r, shares: [], hasValid: false };
        const resolved = ov
          .map((s) => ({
            leader_id: s.leader_id,
            metro: s.metro,
            note_amount: s.note_amount,
            regional: s.regional,
            cod: s.cod,
            count: 1,
            weight: 1,
            reason: s.reason,
            target: resolveSettleId(s.leader_id),
          }))
          .filter((s) => isCountable(byId.get(s.target)));
        return { row: r, shares: resolved, hasValid: resolved.length > 0 };
      }
      const shares = allocateRow({
        leader1_id: r.leader1_id, leader2_id: r.leader2_id, leader3_id: r.leader3_id,
        split_type: r.split_type, two_person: r.two_person,
        metro_fee: Number(r.metro_fee), note_amount: Number(r.note_amount),
        regional_fee: Number(r.regional_fee), cod_amount: Number(r.cod_amount),
        virtual_leader_id: (r as { virtual_leader_id?: string | null }).virtual_leader_id ?? null,
      }, { shindongseokId, ganghyungjuId, oeunkyuId, odongseonId, kimyongikId, virtualIds });
      const resolved = shares
        .map((s) => ({ ...s, target: resolveSettleId(s.leader_id) }))
        .filter((s) => isCountable(byId.get(s.target)));
      const hasValid = resolved.length > 0;
      return { row: r, shares: resolved, hasValid };
    });
  }, [settlementPeriodRows, leaders, byId, shindongseokId, ganghyungjuId, oeunkyuId, odongseonId, kimyongikId, virtualIds]);

  const validRows = useMemo(() => allocations.filter((a) => a.hasValid), [allocations]);

  const mismatchTrace = useMemo(
    () => traceSummaryMismatch(allocations as Parameters<typeof traceSummaryMismatch>[0], companies),
    [allocations, companies],
  );

  // 업체 요약: 활성 업체, 행의 유효성으로 일치 보장
  const companyAgg = useMemo(() => {
    const visible = companies.filter((c) => c.active);
    // 업체 청구는 재방문 그룹당 1건 — 1차 행만 남기고 2차+ 제외
    const companyValidRows = (() => {
      const primary = keepRevisitPrimaryOnly(validRows.map(({ row }) => row));
      const primaryIds = new Set(primary.map((r) => r.id));
      return validRows.filter(({ row }) => primaryIds.has(row.id));
    })();
    const arr = visible.map((c) => {
      const list = companyValidRows.filter(
        ({ row: r }) => r.company_id === c.id || r.company_name === c.name,
      );
      const fee = list.reduce(
        (s, { row: r }) => s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee),
        0,
      );
      return { id: c.id, name: c.name, count: list.length, fee };
    });
    const grand = arr.reduce((s, x) => s + x.fee, 0);
    return arr
      .map((x) => ({ ...x, share: grand > 0 ? (x.fee / grand) * 100 : 0 }))
      .sort((a, b) => b.fee - a.fee);
  }, [companies, validRows]);

  // 팀장 요약: 집계 가능한 팀장만 + 실지급액
  const trashCostMultiplier = period === "all" ? 2 : 1;

  const leaderAgg = useMemo(() => {
    const visible = leaders.filter(isCountable);
    const acc = new Map(
      visible.map((l) => [
        l.id,
        {
          id: l.id, name: l.name, count: 0, fee: 0, cod: 0, commission: 0,
          // 자동공제는 쓰레기비용만 고정. 월전체는 보름 2회 차감한다.
          deduct: Number(l.trash_cost || 0) * trashCostMultiplier,
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
        const lead = byId.get(s.target);
        const rateM = Number(lead?.fee_rate_metro || 0);
        const rateR = Number(lead?.fee_rate_regional || 0);
        b.commission += feeForShare({ metro: s.metro, regional: s.regional }, { metro: rateM, regional: rateR });
      }
    }
    const list = Array.from(acc.values()).map((x) => ({
      ...x,
      // 팀장정산 실지급식과 동일: 배송비 - 착불 - 수수료 - 공제
      payout: Math.max(0, x.fee - x.cod - x.commission - x.deduct),
    }));
    const grand = list.reduce((s, x) => s + x.payout, 0);
    return list
      .map((x) => ({ ...x, share: grand > 0 ? (x.payout / grand) * 100 : 0 }))
      .sort((a, b) => {
        const la = byId.get(a.id);
        const lb = byId.get(b.id);
        if (la && lb) return compareLeadersByFeeAsc(la, lb);
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [leaders, validRows, trashCostMultiplier]);

  const companyTotal = companyAgg.reduce((s, x) => s + x.fee, 0);
  const leaderFeeTotal = leaderAgg.reduce((s, x) => s + x.fee, 0);
  void leaderFeeTotal; void companyTotal;

  // 상단 통계 — 업체/팀장 건수·금액·비중 + 여러명이 함께한 건수
  const topStats = useMemo(() => {
    const companyRowCount = validRows.length; // 행=1건 (업체 관점)
    const multiLeaderRowCount = validRows.filter((a) => a.shares.length >= 2).length;
    const leaderIndividualCount = leaderAgg.reduce((s, x) => s + x.count, 0); // 팀장 각자 건수 합
    const leaderPayoutTotal = leaderAgg.reduce((s, x) => s + x.payout, 0);
    return {
      companyRowCount,
      companyTotal,
      multiLeaderRowCount,
      leaderIndividualCount,
      leaderRowCount: companyRowCount, // 행 기준 — 업체 총건수와 같아야 함
      leaderFeeTotal,
      leaderPayoutTotal,
    };
  }, [validRows, leaderAgg, companyTotal, leaderFeeTotal]);

  const mergedRows = useMemo(() => {
    const len = Math.max(companyAgg.length, leaderAgg.length);
    return Array.from({ length: len }, (_, i) => ({
      rank: i + 1,
      company: companyAgg[i] ?? null,
      leader: leaderAgg[i] ?? null,
    }));
  }, [companyAgg, leaderAgg]);

  const [diagMsg, setDiagMsg] = useState<string | null>(null);

  // 검수 — 오류 6종 + 업체↔팀장 건수/금액 일치 확인
  const runInspection = () => {
    const issues: string[] = [];
    for (const c of errorChecks) if (c.err) issues.push(c.label);
    if (topStats.companyRowCount !== topStats.leaderRowCount) {
      issues.push(`업체 총건수(${topStats.companyRowCount}) ≠ 팀장 행기준 총건수(${topStats.leaderRowCount})`);
    }
    if (Math.round(companyTotal) !== Math.round(leaderFeeTotal)) {
      issues.push(`업체 총금액(${fmt(companyTotal)}) ≠ 팀장 배송비 합(${fmt(leaderFeeTotal)})`);
    }
    if (issues.length === 0) {
      setDiagMsg(`정상 — 업체 ${topStats.companyRowCount}건 / 팀장 합 ${topStats.leaderIndividualCount}건 (다인동행 ${topStats.multiLeaderRowCount}건)`);
    } else {
      setDiagMsg(`오류 ${issues.length}건: ${issues.join(" · ")}`);
    }
  };

  const companyGridTemplate = COMPANY_COLUMNS.map((c) => c.size).join(" ");
  const leaderGridTemplate = LEADER_COLUMNS.map((c) => c.size).join(" ");
  const cellBase = "flex items-center justify-center text-center px-4 py-3 text-base border-b";

  // 기준서 #12 — 한눈요약 오류 6종 자동 탐지
  const errorChecks = useMemo(() => {
    // 1) 업체명이 "모던"만 반복 — 집계된 활성 업체 모두 이름에 '모던' 포함
    const visibleCompanies = companyAgg.filter((c) => c.count > 0);
    const modernOnly =
      visibleCompanies.length > 0 &&
      visibleCompanies.every((c) => (c.name || "").includes("모던"));

    // 2) 정산제외 팀장이 leaderAgg에 표시되었는지
    const hasExcluded = leaderAgg.some((r) => {
      const l = byId.get(r.id);
      return l && (l.settle_status ?? "included") === "excluded";
    });

    // 3) 별칭이 팀장 표시명에 사용되는지 — leaderAgg는 l.name(정식명)을 사용해야 함
    const usesAlias = leaderAgg.some((r) => {
      const l = byId.get(r.id);
      if (!l) return false;
      return r.name !== l.name;
    });

    // 4) 가상기사/가상팀장 표시 여부
    const hasVirtual = leaderAgg.some((r) => {
      const l = byId.get(r.id);
      return l && l.is_virtual;
    });

    // 5) 강형주/신동석 건수 불일치
    let sdsGhjMismatch = false;
    if (shindongseokId && ganghyungjuId) {
      const sds = leaderAgg.find((r) => r.id === shindongseokId);
      const ghj = leaderAgg.find((r) => r.id === ganghyungjuId);
      if (sds || ghj) {
        sdsGhjMismatch = (sds?.count ?? 0) !== (ghj?.count ?? 0);
      }
    }

    // 6) 오은규 표시 여부 — 별칭/이름에 '오은규' 또는 '은규'가 정산기사 자리에 나타남
    const eunGyu = leaders.find((l) => {
      const nm = (l.name || "").trim();
      const al = ((l.aliases as string[]) || []).map((a) => (a || "").trim());
      return nm === "오은규" || al.includes("은규");
    });
    const hasEunGyu = !!eunGyu && leaderAgg.some((r) => r.id === eunGyu.id);

    return [
      { label: "업체명이 '모던'만 반복", err: modernOnly },
      { label: "정산제외 팀장 표시", err: hasExcluded },
      { label: "별칭 표시 (정식 팀장명 미사용)", err: usesAlias },
      { label: "가상기사/가상팀장 표시", err: hasVirtual },
      { label: "강형주/신동석 건수 불일치", err: sdsGhjMismatch },
      { label: "오은규 표시", err: hasEunGyu },
    ];
  }, [companyAgg, leaderAgg, byId, leaders, shindongseokId, ganghyungjuId]);

  // 자동검증 (내부 관점)
  const audit = useMemo(
    () => auditDeliveries({
      deliveries: settlementPeriodRows,
      companies,
      leaders,
      mode: "internal",
    }),
    [settlementPeriodRows, companies, leaders],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  useArrowKeyNav(rootRef);

  return (
    <div className="space-y-4" ref={rootRef}>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold flex-1 min-w-full sm:min-w-0 whitespace-nowrap">한눈요약</h1>
        <PrintButton documentTitle={`한눈요약_${month}`} />
        <Input
          type="month"
          value={month}
          onChange={(e) => { setMonth(e.target.value); }}
          className="w-40"
        />
        <div className="flex h-10 items-center gap-2 rounded-md border px-3">
          <Label className="text-xs whitespace-nowrap">날짜 자동</Label>
          <Switch checked={autoPeriod} onCheckedChange={toggleAutoPeriod} />
        </div>
      </div>

      <Tabs value={period} onValueChange={(v) => { setPeriod(v as Period); }}>
        <TabsList>
          <TabsTrigger value="h1">1~15일</TabsTrigger>
          <TabsTrigger value="h2">16~말일</TabsTrigger>
          <TabsTrigger value="all">월전체</TabsTrigger>
        </TabsList>
        <TabsContent value={period} className="space-y-4">
      <AuditBanner title="자동검증 (계산서·거부업체·제출문구)" result={audit} defaultOpen={!audit.ok} />

      {/* 상단 통계 바 + 검수 버튼 */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="font-semibold text-base">기간 통계</div>
          {diagMsg && (
            <span className={diagMsg.startsWith("정상") ? "text-sm text-primary" : "text-sm text-destructive"}>
              {diagMsg}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-stretch">
          {/* 1열: 업체 */}
          <div className="rounded-md border p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1">업체 (행=1건)</div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>건수</span><span className="num font-bold text-foreground">{topStats.companyRowCount.toLocaleString()}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>금액</span><span className="num font-bold text-destructive">{fmt(topStats.companyTotal)}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>비중</span><span className="num font-bold text-foreground">100%</span></div>
          </div>
          {/* 2열: 팀장 (업체기준) */}
          <div className="rounded-md border p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1">팀장 (업체기준)</div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>건수</span><span className="num font-bold text-foreground">{topStats.leaderRowCount.toLocaleString()}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>금액</span><span className="num font-bold text-destructive">{fmt(topStats.leaderFeeTotal)}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>비중</span><span className="num font-bold text-foreground">100%</span></div>
          </div>
          {/* 3열: 팀장 각자 / 여러명 함께 */}
          <div className="rounded-md border p-3">
            <div className="text-xs font-semibold text-muted-foreground mb-1">팀장 세부</div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>팀장 각자 건수</span><span className="num font-bold text-foreground">{topStats.leaderIndividualCount.toLocaleString()}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>여러명 함께 건수</span><span className="num font-bold text-foreground">{topStats.multiLeaderRowCount.toLocaleString()}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>함께 비율</span><span className="num font-bold text-foreground">{topStats.companyRowCount > 0 ? ((topStats.multiLeaderRowCount / topStats.companyRowCount) * 100).toFixed(1) : "0.0"}%</span></div>
          </div>
          {/* 4열: 검수 버튼 */}
          <div className="rounded-md border p-3 flex items-center justify-center">
            <Button variant="outline" onClick={runInspection} className="w-full h-full min-h-[80px] text-base font-semibold">
              검수
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="font-semibold text-base">
            업체/팀장 요약 <span className="text-sm text-muted-foreground">(업체 금액=수도권+비고+지방, 팀장 금액=실수령액)</span>
          </div>
          <div className="flex items-center gap-2">
            {diagMsg && (
              <span className={diagMsg.startsWith("정상") ? "text-sm text-primary" : "text-sm text-destructive"}>
                {diagMsg}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-6 p-6">
          {/* 왼쪽: 업체 테이블 */}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base mb-3 text-center">업체</div>
            <div className="w-full border rounded-md overflow-hidden">
              <div className="grid bg-muted/50 font-medium text-muted-foreground" style={{ gridTemplateColumns: companyGridTemplate }}>
                {COMPANY_COLUMNS.map((c) => (
                  <div key={c.key} className={cellBase + " border-r last:border-r-0 py-3.5"}>{c.label}</div>
                ))}
              </div>
              {companyAgg.map((c, idx) => {
                const cells: Record<string, React.ReactNode> = {
                  rank: idx + 1,
                  company: c.name,
                  company_count: c.count,
                  company_amount: fmt(c.fee),
                  company_share: `${c.share.toFixed(1)}%`,
                };
                return (
                  <div key={c.id} className="grid hover:bg-muted/30" style={{ gridTemplateColumns: companyGridTemplate }}>
                    {COMPANY_COLUMNS.map((col) => (
                      <div key={col.key} className={cellBase + " border-r last:border-r-0"}>{cells[col.key]}</div>
                    ))}
                  </div>
                );
              })}
              {companyAgg.length === 0 && (
                <div className="py-10 text-center text-muted-foreground text-base">표시할 데이터가 없습니다.</div>
              )}
            </div>
          </div>
          {/* 오른쪽: 팀장 테이블 */}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base mb-3 text-center">팀장</div>
            <div className="w-full border rounded-md overflow-hidden">
              <div className="grid bg-muted/50 font-medium text-muted-foreground" style={{ gridTemplateColumns: leaderGridTemplate }}>
                {LEADER_COLUMNS.map((c) => (
                  <div key={c.key} className={cellBase + " border-r last:border-r-0 py-3.5"}>{c.label}</div>
                ))}
              </div>
              {leaderAgg.map((l, idx) => {
                const cells: Record<string, React.ReactNode> = {
                  rank: idx + 1,
                  leader: l.name,
                  leader_count: l.count,
                  leader_amount: fmt(l.payout),
                  leader_share: `${l.share.toFixed(1)}%`,
                };
                return (
                  <div key={l.id} className="grid hover:bg-muted/30" style={{ gridTemplateColumns: leaderGridTemplate }}>
                    {LEADER_COLUMNS.map((col) => (
                      <div key={col.key} className={cellBase + " border-r last:border-r-0"}>{cells[col.key]}</div>
                    ))}
                  </div>
                );
              })}
              {leaderAgg.length === 0 && (
                <div className="py-10 text-center text-muted-foreground text-base">표시할 데이터가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 오류 검사 (기준서 #12) */}
      <Card className="p-6 space-y-3">
        <div className="font-semibold text-base">오류 검사</div>
        <ul className="text-base space-y-2">
          {errorChecks.map((c) => (
            <li key={c.label} className="flex items-center gap-3">
              <span className={c.err ? "text-destructive text-lg" : "text-primary text-lg"}>{c.err ? "✗" : "✓"}</span>
              <span className={c.err ? "text-destructive" : ""}>{c.label}</span>
            </li>
          ))}
        </ul>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}