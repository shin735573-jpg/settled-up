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
import { allocateRow, feeForShare, type LeaderShare } from "@/lib/splitAllocation";

type Period = "all" | "first" | "second" | "month";

// ===== 팀장정산 전체 목록 컬럼 정의 (헤더/바디 단일 소스) =====
type LeaderColKey =
  | "name" | "count" | "metro" | "note" | "regional" | "total"
  | "cod" | "fees" | "afterFees" | "deduction" | "net" | "status" | "detail";

type LeaderCol = {
  key: LeaderColKey;
  label: string;
  width: number; // px (최소 너비, table-fixed + colgroup 으로 헤더/바디 동일 적용)
  align: "center";
};

const LEADER_COLUMNS: LeaderCol[] = [
  { key: "name",       label: "팀장명",         width: 130, align: "center" },
  { key: "count",      label: "배송건수",       width: 90,  align: "center" },
  { key: "metro",      label: "수도권배송비",   width: 140, align: "center" },
  { key: "note",       label: "비고금액",       width: 130, align: "center" },
  { key: "regional",   label: "지방배송비",     width: 140, align: "center" },
  { key: "total",      label: "실지급배송비",   width: 150, align: "center" },
  { key: "cod",        label: "착불합계",       width: 130, align: "center" },
  { key: "fees",       label: "수수료합계",     width: 140, align: "center" },
  { key: "afterFees",  label: "계산후 지급금액", width: 160, align: "center" },
  { key: "deduction",  label: "공제총액",       width: 130, align: "center" },
  { key: "net",        label: "실지급액",       width: 140, align: "center" },
  { key: "status",     label: "정산상태",       width: 120, align: "center" },
  { key: "detail",     label: "상세보기",       width: 100, align: "center" },
];
const LEADER_TABLE_MIN_WIDTH = LEADER_COLUMNS.reduce((s, c) => s + c.width, 0);

type Leader = {
  id: string; name: string; aliases?: string[] | null; display_suffix?: string | null;
  is_rejected: boolean; is_virtual: boolean; active: boolean;
  settle_to_id: string | null; fee_rate_metro: number; fee_rate_regional: number;
  deduction_amount: number; trash_cost: number;
  settle_status?: "included" | "excluded" | null;
};
type Delivery = {
  id: string; date: string; company_id: string | null; company_name: string;
  customer_name: string | null; region: string | null; item: string | null; note: string | null;
  metro_fee: number; note_amount: number; regional_fee: number; cod_amount: number;
  region_type: string | null; split_type: string | null; paid: boolean; two_person?: boolean | null;
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
const normalizeDeductionLabel = (v: string) => v.trim().replace(/\s+/g, "").toLowerCase();

/** 행에서 정산기사(=정산귀속 후의 팀장) ID 찾기. settle_to_id 따라 redirect. */
function settlementLeaderIdFor(r: Delivery, byId: Map<string, Leader>): string | null {
  for (const id of [r.leader1_id, r.leader2_id, r.leader3_id]) {
    if (!id) continue;
    const l = byId.get(id);
    if (!l) continue;
    // settle_to_id 체인을 끝까지 따라감 (순환 방어)
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

/** 행의 실제기사(원본 leader1) ID. */
function realLeaderIdFor(r: Delivery, byId: Map<string, Leader>): string | null {
  const id = r.leader1_id;
  if (!id) return null;
  return byId.has(id) ? id : null;
}

export default function LeaderSettlement() {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [period, setPeriod] = useState<Period>("month");
  const [leaders, setLeaders] = useState<Leader[]>([]);
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
      const [{ data: l }, { data: cd }] = await Promise.all([
        supabase.from("team_leaders").select("*").order("name"),
        supabase.from("common_deductions").select("id,label,amount,active").order("sort_order"),
      ]);
      setLeaders((l as Leader[]) || []);
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
  const sdsOpts = { shindongseokId, ganghyungjuId };

  /** 원본 배분(재분배 전) 기준 한 팀장의 합계. basis="raw"일 때 사용. */
  const rawTotalsFor = (lid: string) => {
    let metro = 0, noteAmt = 0, regional = 0, cod = 0, count = 0;
    rows.forEach((r) => {
      const shares = allocateRow({
        leader1_id: r.leader1_id, leader2_id: r.leader2_id, leader3_id: r.leader3_id,
        split_type: r.split_type, two_person: r.two_person,
        metro_fee: num(r.metro_fee), note_amount: num(r.note_amount),
        regional_fee: num(r.regional_fee), cod_amount: num(r.cod_amount),
      }); // opts 미전달 → 재분배 비활성
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
    () => leaders.filter(
      (l) => l.active && !l.is_rejected && !l.settle_to_id && (l.settle_status ?? "included") !== "excluded",
    ),
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
    const targets = targetSetFor(settlingLid);
    const shares = allocateRow({
      leader1_id: r.leader1_id, leader2_id: r.leader2_id, leader3_id: r.leader3_id,
      split_type: r.split_type, two_person: r.two_person,
      metro_fee: num(r.metro_fee), note_amount: num(r.note_amount),
      regional_fee: num(r.regional_fee), cod_amount: num(r.cod_amount),
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
      // 배송건이 없는 팀장에게는 공통공제(쓰레기비용 등)를 적용하지 않음
      const common = count > 0 ? commonTotalFor(l.id) : 0;
      const deduction = common + indiv;
      const net = afterFees - cod - deduction;
      return {
        leader: l,
        count,
        metro, noteAmt, regional, cod,
        total,
        fees, afterFees, common, indiv, deduction, net,
      };
    }).filter((m) => m.count > 0 || m.indiv > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlingLeaders, rows, leaders, activeCommonDeductions, commonOverrides, periodDeductions]);

  const periodLabel =
    period === "all" ? "전체 기간" :
    period === "first" ? `${month} 1~15일` :
    period === "second" ? `${month} 16~말일` :
    `${month} 월전체`;

  // 상단 요약바: 정산귀속/팀 재분배가 모두 반영된 masterRows 기준 합계
  const topSummary = useMemo(() => {
    let totalCount = 0, totalCod = 0, totalFee = 0;
    masterRows.forEach((m) => {
      totalCount += m.count;
      totalCod += m.cod;
      totalFee += m.total;
    });
    return {
      totalLeaders: masterRows.length,
      totalCount,
      totalCod,
      totalFee,
    };
  }, [masterRows]);

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
    // 배송건이 없는 팀장은 공통공제(쓰레기비용 등)를 적용하지 않음
    const commonTotal = count === 0 ? 0 : activeCommonDeductions.reduce((s, cd) => {
      const cdTotal = commonPeriodKeys.reduce((periodSum, pKey) => {
        const editKey = `${cd.id}__${pKey}`;
        const edited = detailCommonEdits[editKey];
        if (typeof edited === "number") return periodSum + edited;
        const ov = detailLeader
          ? commonOverrides.find(
              (o) => o.leader_id === detailLeader.id && o.common_deduction_id === cd.id && o.period_key === pKey,
            )
          : undefined;
        return periodSum + (ov ? num(ov.amount) : num(cd.amount));
      }, 0);
      return s + cdTotal;
    }, 0);
    const deduction = commonTotal + indivTotal;
    const net = afterFees - cod - deduction;
    return { metro, noteAmt, regional, cod, total, fees, afterFees, deduction, net, mergedTotal, mergedCount, indivTotal, commonTotal, count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRows, detailLeader, mergedIdSet, detailDeductions, detailCommonEdits, activeCommonDeductions, commonOverrides]);

  // 상세화면 업체별 요약 (기준서: 업체명/건수/수도권/비고/지방/실지급배송비/착불/수수료/계산후 지급금액)
  const detailByCompany = useMemo(() => {
    if (!leaderId) return [] as Array<{
      company: string; count: number; metro: number; noteAmt: number; regional: number;
      total: number; cod: number; fees: number; afterFees: number;
    }>;
    const map = new Map<string, {
      company: string; count: number; metro: number; noteAmt: number; regional: number;
      cod: number; fees: number;
    }>();
    detailRows.forEach((r) => {
      const share = shareForSettling(r, leaderId);
      if (!share) return;
      const key = r.company_name || "(미지정)";
      const cur = map.get(key) || { company: key, count: 0, metro: 0, noteAmt: 0, regional: 0, cod: 0, fees: 0 };
      cur.count += share.count;
      cur.metro += share.metro;
      cur.noteAmt += share.noteAmt;
      cur.regional += share.regional;
      cur.cod += share.cod;
      cur.fees += feeForRowSettling(r, leaderId);
      map.set(key, cur);
    });
    return Array.from(map.values())
      .map((v) => {
        const total = v.metro + v.noteAmt + v.regional;
        return { ...v, total, afterFees: total - v.fees };
      })
      .sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRows, leaderId, leaders]);

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <LeaderSummaryCard label="총팀장수" value={topSummary.totalLeaders.toLocaleString()} />
          <LeaderSummaryCard label="총배송건수" value={topSummary.totalCount.toLocaleString()} />
          <LeaderSummaryCard label="총착불금액" value={fmt(topSummary.totalCod)} accent />
          <LeaderSummaryCard label="총배송비" value={fmt(topSummary.totalFee)} bold />
        </div>
      )}

      {!leaderId && (
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-2">{periodLabel} 기준 · 팀장명 클릭 시 상세보기</div>
          {leaderColAlignError && (
            <div className="mb-2 rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive font-medium">
              팀장정산 목록의 헤더와 데이터 컬럼 위치가 일치하지 않습니다.
            </div>
          )}
          <div className="w-full overflow-x-auto">
            <table
              data-testid="leader-summary-table"
              className="text-sm num table-fixed border-collapse"
              style={{ minWidth: `${LEADER_TABLE_MIN_WIDTH}px`, width: `${LEADER_TABLE_MIN_WIDTH}px` }}
            >
              <colgroup>
                {LEADER_COLUMNS.map((c) => (
                  <col key={c.key} style={{ width: `${c.width}px` }} />
                ))}
              </colgroup>
              <thead className="[&_tr]:border-b">
                <tr className="border-b">
                  {LEADER_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className="h-12 px-2 text-center align-middle font-medium text-muted-foreground whitespace-nowrap"
                      style={{ width: `${c.width}px` }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {masterRows.map((m) => {
                  const statusText =
                    m.leader.settle_status === "excluded" ? "정산제외" : "미정산";
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
                    total: <span className="font-semibold">{fmt(m.total)}</span>,
                    cod: fmt(m.cod),
                    fees: fmt(m.fees),
                    afterFees: fmt(m.afterFees),
                    deduction: fmt(m.deduction),
                    net: <span className="font-bold">{fmt(m.net)}</span>,
                    status: (
                      <span className="inline-block rounded px-2 py-0.5 text-xs bg-muted text-muted-foreground">
                        {statusText}
                      </span>
                    ),
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
                          style={{ width: `${c.width}px` }}
                        >
                          {cells[c.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
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

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 num">
            <Stat label="배송건수" value={detailCalc.count} raw />
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
                {activeCommonDeductions.flatMap((cd) =>
                  commonPeriodKeys.map((pKey) => {
                    const base = num(cd.amount);
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

          <Card className="p-3 mb-4">
            <h3 className="font-semibold text-sm mb-2">업체별 요약</h3>
            <div className="overflow-x-auto">
              <Table className="text-xs num">
                <TableHeader>
                  <TableRow>
                    <TableHead>업체명</TableHead>
                    <TableHead className="text-right">배송건수</TableHead>
                    <TableHead className="text-right">수도권배송비</TableHead>
                    <TableHead className="text-right">비고금액</TableHead>
                    <TableHead className="text-right">지방배송비</TableHead>
                    <TableHead className="text-right">실지급배송비</TableHead>
                    <TableHead className="text-right">착불합계</TableHead>
                    <TableHead className="text-right">수수료합계</TableHead>
                    <TableHead className="text-right">계산후 지급금액</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailByCompany.map((c) => (
                    <TableRow key={c.company}>
                      <TableCell>{c.company}</TableCell>
                      <TableCell className="text-right">{c.count}</TableCell>
                      <TableCell className="text-right">{fmt(c.metro)}</TableCell>
                      <TableCell className="text-right">{fmt(c.noteAmt)}</TableCell>
                      <TableCell className="text-right">{fmt(c.regional)}</TableCell>
                      <TableCell className="text-right font-semibold">{fmt(c.total)}</TableCell>
                      <TableCell className="text-right">{fmt(c.cod)}</TableCell>
                      <TableCell className="text-right">{fmt(c.fees)}</TableCell>
                      <TableCell className="text-right font-bold">{fmt(c.afterFees)}</TableCell>
                    </TableRow>
                  ))}
                  {detailByCompany.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-4">데이터 없음</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

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
                    : r.leader2_name;
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
                      <TableCell>{real2Name || "-"}</TableCell>
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
                      <TableCell className="text-right">{fmt(afterFee)}</TableCell>
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
    <div className={`p-3 rounded border ${highlight ? "bg-primary/10 border-primary" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{raw ? value : fmt(value)}</div>
    </div>
  );
}

function LeaderSummaryCard({
  label, value, accent, bold,
}: { label: string; value: string; accent?: boolean; bold?: boolean }) {
  return (
    <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50">
      <div className="text-xs text-emerald-900/70">{label}</div>
      <div
        className={`mt-1 num ${bold ? "text-2xl font-extrabold" : "text-2xl font-bold"} ${
          accent ? "text-orange-600" : "text-emerald-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

