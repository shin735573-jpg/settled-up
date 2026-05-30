import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { fmt } from "@/lib/format";
import { getDisplayName } from "@/lib/leaderResolver";

type Period = "all" | "first" | "second" | "month";

type Leader = {
  id: string; name: string; aliases?: string[] | null; display_suffix?: string | null;
  is_rejected: boolean; is_virtual: boolean; active: boolean;
  settle_to_id: string | null; deduction_amount: number; trash_cost: number;
};
type Company = { id: string; name: string; fee_rate_metro: number; fee_rate_regional: number };
type Delivery = {
  id: string; date: string; company_id: string | null; company_name: string;
  customer_name: string | null; region: string | null; item: string | null; note: string | null;
  metro_fee: number; note_amount: number; regional_fee: number; cod_amount: number;
  region_type: string | null; split_type: string | null; paid: boolean;
  leader1_id: string | null; leader1_name: string | null;
  leader2_id: string | null; leader2_name: string | null;
  leader3_id: string | null; leader3_name: string | null;
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

/** 행에서 정산기사(=정산귀속 후의 팀장) ID 찾기. settle_to_id 따라 redirect. */
function settlementLeaderIdFor(r: Delivery, byId: Map<string, Leader>): string | null {
  for (const id of [r.leader1_id, r.leader2_id, r.leader3_id]) {
    if (!id) continue;
    const l = byId.get(id);
    if (!l) continue;
    return l.settle_to_id || l.id;
  }
  return null;
}

/** 행의 실제기사(원본 leader1) ID. */
function realLeaderIdFor(r: Delivery, byId: Map<string, Leader>): string | null {
  const id = r.leader1_id;
  if (!id) return null;
  return byId.has(id) ? id : null;
}

/** 건별 수수료: region_type별로 업체 수수료율 적용. */
function feeFor(r: Delivery, company: Company | undefined): number {
  if (!company) return 0;
  const total = sumFee(r);
  const rate = r.region_type === "regional"
    ? num(company.fee_rate_regional)
    : num(company.fee_rate_metro);
  return Math.round(total * rate / 100);
}

export default function LeaderSettlement() {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [period, setPeriod] = useState<Period>("month");
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [leaderId, setLeaderId] = useState<string>("");
  const [commonDeductions, setCommonDeductions] = useState<CommonDeduction[]>([]);
  const [periodDeductions, setPeriodDeductions] = useState<LeaderPeriodDeduction[]>([]);
  const [detailDeductions, setDetailDeductions] = useState<LeaderPeriodDeduction[]>([]);
  const [savingDeductions, setSavingDeductions] = useState(false);
  const [commonOverrides, setCommonOverrides] = useState<LeaderCommonOverride[]>([]);
  // 상세 화면에서 편집 중인 공통공제 값 (cd_id -> amount). undefined면 base 사용.
  const [detailCommonEdits, setDetailCommonEdits] = useState<Record<string, number>>({});
  const [savingCommon, setSavingCommon] = useState(false);

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
      const [{ data: l }, { data: c }, { data: cd }] = await Promise.all([
        supabase.from("team_leaders").select("*").order("name"),
        supabase.from("companies").select("id,name,fee_rate_metro,fee_rate_regional"),
        supabase.from("common_deductions").select("id,label,amount,active").order("sort_order"),
      ]);
      setLeaders((l as Leader[]) || []);
      setCompanies((c as Company[]) || []);
      setCommonDeductions((cd as CommonDeduction[]) || []);
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
      const { data } = await q;
      setRows((data as Delivery[]) || []);
    })();
  }, [range.start, range.end]);

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
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  const activeCommonDeductions = useMemo(
    () => commonDeductions.filter((c) => c.active && (c.label || "").trim()),
    [commonDeductions],
  );

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
      total += ov ? num(ov.amount) : num(cd.amount);
    }
    return total;
  };

  /** 팀장 공통공제 합계 (오버라이드 반영). */
  const commonTotalFor = (leaderId: string): number =>
    activeCommonDeductions.reduce((s, cd) => s + effectiveCommonAmount(leaderId, cd), 0);

  const individualTotalFor = (lid: string): number =>
    periodDeductions
      .filter((d) => d.leader_id === lid)
      .reduce((s, d) => s + (num(d.amount) > 0 && (d.label || "").trim() ? num(d.amount) : 0), 0);

  /** 정산대상 팀장 목록: 활성 + 다른 팀장에게 정산귀속 안 된 팀장 */
  const settlingLeaders = useMemo(
    () => leaders.filter((l) => l.active && !l.settle_to_id),
    [leaders],
  );

  /** leaderId(정산기사) → 합산 대상 ID 집합 (본인 + 본인에게 settle_to인 팀장들) */
  const targetSetFor = (lid: string): Set<string> => {
    const s = new Set<string>([lid]);
    leaders.forEach((l) => { if (l.settle_to_id === lid) s.add(l.id); });
    return s;
  };

  /** 한 팀장(정산기사)에 귀속되는 행 추출 */
  const rowsForSettling = (lid: string): Delivery[] => {
    const targets = targetSetFor(lid);
    return rows.filter((r) => {
      const ids = [r.leader1_id, r.leader2_id, r.leader3_id].filter(Boolean) as string[];
      return ids.some((id) => targets.has(id));
    });
  };

  // ===== 마스터 목록 집계 =====
  const masterRows = useMemo(() => {
    return settlingLeaders.map((l) => {
      const rs = rowsForSettling(l.id);
      let metro = 0, noteAmt = 0, regional = 0, cod = 0, fees = 0;
      rs.forEach((r) => {
        metro += num(r.metro_fee);
        noteAmt += num(r.note_amount);
        regional += num(r.regional_fee);
        cod += num(r.cod_amount);
        fees += feeFor(r, r.company_id ? companyById.get(r.company_id) : undefined);
      });
      const total = metro + noteAmt + regional;
      const afterFees = total - fees;
      const indiv = individualTotalFor(l.id);
      const common = commonTotalFor(l.id);
      const deduction = common + indiv;
      const net = afterFees - cod - deduction;
      return {
        leader: l,
        count: rs.length,
        metro, noteAmt, regional, cod,
        total,
        fees, afterFees, common, indiv, deduction, net,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlingLeaders, rows, leaders, activeCommonDeductions, commonOverrides, periodDeductions]);

  const periodLabel =
    period === "all" ? "전체 기간" :
    period === "first" ? `${month} 1~15일` :
    period === "second" ? `${month} 16~말일` :
    `${month} 월전체`;

  // ===== 상세 모드 =====
  const detailLeader = leaderId ? leadersById.get(leaderId) : undefined;
  const detailRows = useMemo(
    () => (leaderId ? rowsForSettling(leaderId) : []),
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
    let mergedTotal = 0, mergedCount = 0;
    detailRows.forEach((r) => {
      metro += num(r.metro_fee);
      noteAmt += num(r.note_amount);
      regional += num(r.regional_fee);
      cod += num(r.cod_amount);
      fees += feeFor(r, r.company_id ? companyById.get(r.company_id) : undefined);
      if (mergedSourceForRow(r)) {
        mergedTotal += sumFee(r);
        mergedCount += 1;
      }
    });
    const total = metro + noteAmt + regional;
    const afterFees = total - fees;
    const indivTotal = detailDeductions.reduce(
      (s, d) => s + (num(d.amount) > 0 && (d.label || "").trim() ? num(d.amount) : 0),
      0,
    );
    // 상세 공통공제: 편집중 값(detailCommonEdits) 우선, 없으면 오버라이드, 없으면 base
    const commonTotal = activeCommonDeductions.reduce((s, cd) => {
      const edited = detailCommonEdits[cd.id];
      if (typeof edited === "number") return s + edited;
      return s + (detailLeader ? effectiveCommonAmount(detailLeader.id, cd) : num(cd.amount));
    }, 0);
    const deduction = commonTotal + indivTotal;
    const net = afterFees - cod - deduction;
    return { metro, noteAmt, regional, cod, total, fees, afterFees, deduction, net, mergedTotal, mergedCount, indivTotal, commonTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRows, companyById, detailLeader, mergedIdSet, detailDeductions, detailCommonEdits, activeCommonDeductions, commonOverrides]);

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
    setSavingCommon(true);
    for (const [editKey, amount] of entries) {
      // editKey 형식: `${cdId}__${periodKey}`
      const [cdId, pKey] = editKey.split("__");
      if (!cdId || !pKey) continue;
      const cd = commonDeductions.find((c) => c.id === cdId);
      if (!cd) continue;
      if (Number(amount) === num(cd.amount)) {
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {leaderId && (
          <Button variant="outline" size="sm" onClick={() => setLeaderId("")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 전체 팀장 목록
          </Button>
        )}
        <h1 className="text-2xl font-bold flex-1">팀장정산</h1>
        <input
          type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          disabled={period === "all"} className="border rounded px-3 py-2"
        />
        <div className="flex gap-1">
          {([
            ["all", "전체"],
            ["first", "1~15일"],
            ["second", "16~말일"],
            ["month", "월전체"],
          ] as [Period, string][]).map(([p, label]) => (
            <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      {!leaderId && (
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-2">{periodLabel} 기준 · 팀장명 클릭 시 상세보기</div>
          <Table className="text-sm num">
            <TableHeader>
              <TableRow>
                <TableHead>팀장명</TableHead>
                <TableHead className="text-right">배송건수</TableHead>
                <TableHead className="text-right">수도권배송비</TableHead>
                <TableHead className="text-right">비고금액</TableHead>
                <TableHead className="text-right">지방배송비</TableHead>
                <TableHead className="text-right">실지급배송비</TableHead>
                <TableHead className="text-right">착불합계</TableHead>
                <TableHead className="text-right">수수료합계</TableHead>
                <TableHead className="text-right">계산후 지급금액</TableHead>
                <TableHead className="text-right">공제총액</TableHead>
                <TableHead className="text-right">실지급액</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {masterRows.map((m) => (
                <TableRow key={m.leader.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLeaderId(m.leader.id)}>
                  <TableCell>
                    <button className="text-primary hover:underline font-medium">
                      {getDisplayName(m.leader, leaders)}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">{m.count || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(m.metro)}</TableCell>
                  <TableCell className="text-right">{fmt(m.noteAmt)}</TableCell>
                  <TableCell className="text-right">{fmt(m.regional)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(m.total)}</TableCell>
                  <TableCell className="text-right">{fmt(m.cod)}</TableCell>
                  <TableCell className="text-right">{fmt(m.fees)}</TableCell>
                  <TableCell className="text-right">{fmt(m.afterFees)}</TableCell>
                  <TableCell className="text-right">{fmt(m.deduction)}</TableCell>
                  <TableCell className="text-right font-bold">{fmt(m.net)}</TableCell>
                </TableRow>
              ))}
              {masterRows.length === 0 && (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">정산대상 팀장 없음</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
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

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 num">
            <Stat label="배송건수" value={detailRows.length} raw />
            <Stat label="수도권배송비" value={detailCalc.metro} />
            <Stat label="비고금액" value={detailCalc.noteAmt} />
            <Stat label="지방배송비" value={detailCalc.regional} />
            <Stat label="실지급배송비" value={detailCalc.total} />
            <Stat label="착불 합계" value={detailCalc.cod} />
            <Stat label="수수료 합계" value={detailCalc.fees} />
            <Stat label="계산후 지급금액" value={detailCalc.afterFees} />
            <Stat label="공제총액" value={detailCalc.deduction} />
            <Stat label="실지급액" value={detailCalc.net} highlight />
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
                {activeCommonDeductions.map((cd) => {
                  const saved = detailLeader ? effectiveCommonAmount(detailLeader.id, cd) : num(cd.amount);
                  const edited = detailCommonEdits[cd.id];
                  const current = typeof edited === "number" ? edited : saved;
                  const base = num(cd.amount);
                  const ovExists = detailLeader
                    ? commonOverrides.some((o) => o.leader_id === detailLeader.id && o.common_deduction_id === cd.id && commonPeriodKeys.includes(o.period_key))
                    : false;
                  const expectedBase = base * commonPeriodKeys.length;
                  const isCustom = typeof edited === "number" ? edited !== base : ovExists && saved !== expectedBase;
                  const applyLabel = isMultiCommonPeriod
                    ? "1~15일 + 16~말일 (각 1회)"
                    : period === "first" ? "1~15일 (1회)"
                    : period === "second" ? "16~말일 (1회)"
                    : "전체기간 (1회)";
                  return (
                    <div key={cd.id} className="flex gap-2 items-center">
                      <span className="flex-1 text-sm">
                        {cd.label}
                        {isCustom && <span className="ml-1 text-xs text-amber-700">(수정됨)</span>}
                        <span className="ml-1 text-xs text-muted-foreground">기본 {fmt(base)}</span>
                        <span className="ml-2 text-[10px] text-muted-foreground">적용기간: {applyLabel}</span>
                      </span>
                      <Input
                        type="number"
                        className="h-8 w-32 text-right num"
                        value={current}
                        disabled={isMultiCommonPeriod}
                        title={isMultiCommonPeriod ? "월전체에서는 수정 불가 — 보름 기간을 선택하세요" : undefined}
                        onChange={(e) =>
                          setDetailCommonEdits((m) => ({ ...m, [cd.id]: Number(e.target.value) || 0 }))
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="기본값으로 되돌리기"
                        disabled={isMultiCommonPeriod}
                        onClick={() => resetCommonOverride(cd.id, base)}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                * 쓰레기비용 등 공통공제는 팀장 × 보름 기간당 1번만 적용됩니다 (배송건수 무관).
                {isMultiCommonPeriod
                  ? " 월전체에서는 1~15일 + 16~말일의 두 보름 금액이 합산되며, 수정은 보름 기간을 선택해야 합니다."
                  : ` 수정값은 해당 팀장/${periodKey}에만 저장됩니다.`}
              </div>
            </Card>

            <Card className="p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">개별 공제 ({periodLabel})</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm num font-semibold">{fmt(detailCalc.indivTotal)}</span>
                  <Button size="sm" variant="outline" onClick={addDetailDeduction} disabled={detailDeductions.length >= 20}>
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
                    : r.leader2_name;
                  const settleId = settlementLeaderIdFor(r, leadersById);
                  const settleName = settleId ? (leadersById.get(settleId)?.name || "-") : "-";
                  const totalFee = sumFee(r);
                  const fee = feeFor(r, r.company_id ? companyById.get(r.company_id) : undefined);
                  const afterFee = totalFee - fee;
                  return (
                    <TableRow key={r.id} className={src ? "bg-amber-50 hover:bg-amber-100" : ""}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.company_name}</TableCell>
                      <TableCell>{real1Name || "-"}</TableCell>
                      <TableCell>{real2Name || "-"}</TableCell>
                      <TableCell>{settleName}</TableCell>
                      <TableCell>{r.customer_name || "-"}</TableCell>
                      <TableCell>{r.region || "-"}</TableCell>
                      <TableCell className="max-w-[180px] whitespace-pre-wrap break-words">{r.item || "-"}</TableCell>
                      <TableCell className="max-w-[180px] whitespace-pre-wrap break-words">{r.note || "-"}</TableCell>
                      <TableCell className="text-right">{fmt(num(r.metro_fee))}</TableCell>
                      <TableCell className="text-right">{fmt(num(r.note_amount))}</TableCell>
                      <TableCell className="text-right">{fmt(num(r.regional_fee))}</TableCell>
                      <TableCell className="text-right">{fmt(num(r.cod_amount))}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(totalFee)}</TableCell>
                      <TableCell>{r.split_type || "-"}</TableCell>
                      <TableCell className="text-right">{fmt(fee)}</TableCell>
                      <TableCell className="text-right">{fmt(afterFee)}</TableCell>
                      <TableCell className="text-right">{fmt(afterFee)}</TableCell>
                      <TableCell className={src ? "text-amber-800 font-medium" : "text-muted-foreground"}>
                        {src ? `${src.name} → ${detailLeader.name}` : "본인"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {detailRows.length === 0 && (
                  <TableRow><TableCell colSpan={19} className="text-center text-muted-foreground py-6">데이터 없음</TableCell></TableRow>
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
    <div className={`p-3 rounded border ${highlight ? "bg-primary/10 border-primary" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{raw ? value : fmt(value)}</div>
    </div>
  );
}