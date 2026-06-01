import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useArrowKeyNav } from "@/hooks/useArrowKeyNav";
import { useAuth } from "@/hooks/useAuth";
import { sortLeadersByFeeAsc, compareLeadersByFeeAsc } from "@/lib/leaderSort";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus } from "lucide-react";
import { fmt } from "@/lib/format";
import { allocateRow, feeForShare } from "@/lib/splitAllocation";
import { auditDeliveries } from "@/lib/liveAudit";
import { AuditBanner } from "@/components/AuditBanner";
import PrintButton from "@/components/PrintButton";
import { Switch } from "@/components/ui/switch";
import { getCurrentHalf, useAutoPeriodSync } from "@/lib/autoPeriod";
import { toast } from "@/hooks/use-toast";

type Period = "h1" | "h2" | "all";
type Delivery = any;
type Company = {
  id: string; name: string; active: boolean; issues_invoice: boolean;
  fee_rate_metro: number; fee_rate_regional: number;
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
  min_guarantee_enabled?: boolean; min_guarantee_amount?: number;
};

type LoadingCost = {
  id: string; day: number; company_id: string; amount: number;
  billed: "billed" | "unbilled"; invoice: "issued" | "not_issued";
};

type Expenses = {
  rent: number; electric: number; internet: number; caps: number;
  fire: number; repair: number; etc: number;
  additional: { id?: string; date?: string; label: string; amount: number; note?: string }[];
};

const FIXED_LABELS: { key: keyof Omit<Expenses, "additional">; label: string }[] = [
  { key: "rent", label: "월세" },
  { key: "electric", label: "전기세" },
  { key: "internet", label: "인터넷" },
  { key: "caps", label: "캡스" },
  { key: "fire", label: "화재보험" },
  { key: "repair", label: "고장지출" },
  { key: "etc", label: "기타지출" },
];

const inPeriod = (dateStr: string, period: Period): boolean => {
  const d = Number((dateStr || "").slice(8, 10));
  if (!d) return false;
  if (period === "h1") return d >= 1 && d <= 15;
  if (period === "h2") return d >= 16;
  return true;
};

const useLocalState = <T,>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] => {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setV(raw ? (JSON.parse(raw) as T) : initial);
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (next: T | ((p: T) => T)) => {
    setV((prev) => {
      const n = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* noop */ }
      return n;
    });
  };
  return [v, set];
};

const DEFAULT_EXPENSES: Expenses = {
  rent: 0, electric: 0, internet: 0, caps: 0, fire: 0, repair: 0, etc: 0,
  additional: [],
};

export default function HQSettlement() {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const initial = useMemo(() => getCurrentHalf(), []);
  const [autoPeriod, setAutoPeriod] = useState<boolean>(() => {
    try { return localStorage.getItem("hqSettlement.autoPeriod") !== "0"; } catch { return true; }
  });
  const [month, setMonth] = useState(() => initial.month);
  const [period, setPeriod] = useState<Period>(initial.half);
  const toggleAutoPeriod = (v: boolean) => {
    setAutoPeriod(v);
    try { localStorage.setItem("hqSettlement.autoPeriod", v ? "1" : "0"); } catch { /* noop */ }
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
  const [rows, setRows] = useState<Delivery[]>([]);
  const [yearRows, setYearRows] = useState<Delivery[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const expKey = `hq.expenses.${uid}.${month}`;
  const loadKey = `hq.loading.${uid}.${month}`;
  const leaderStatusKey = `hq.leaderStatus.${uid}.${month}.${period}`;
  const companyStatusKey = `hq.companyStatus.${uid}.${month}.${period}`;
  const codCarryKey = `hq.codCarry.${uid}.${month}`;

  const [expenses, setExpenses] = useLocalState<Expenses>(expKey, DEFAULT_EXPENSES);
  const [loadingCosts, setLoadingCosts] = useLocalState<LoadingCost[]>(loadKey, []);
  const [leaderStatus, setLeaderStatus] = useLocalState<Record<string, "settled" | "pending">>(leaderStatusKey, {});
  const [companyStatus, setCompanyStatus] = useLocalState<Record<string, "paid" | "unpaid">>(companyStatusKey, {});
  const [codCarry, setCodCarry] = useLocalState<Record<string, number>>(codCarryKey, {});

  const [leaderFilter, setLeaderFilter] = useState<"all" | "settled" | "pending">("all");
  const [companyFilter, setCompanyFilter] = useState<"all" | "paid" | "unpaid">("all");

  useEffect(() => {
    (async () => {
      const start = month + "-01";
      const next = new Date(start); next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const [{ data: d }, { data: c }, { data: l }] = await Promise.all([
        supabase.from("deliveries").select("*").gte("date", start).lt("date", end),
        supabase.from("companies").select("id,name,active,issues_invoice,fee_rate_metro,fee_rate_regional,rejected_leader_id,rejected_leader_id_2,rejected_leader_id_3").order("name"),
        supabase.from("team_leaders").select("id,name,active,is_rejected,is_virtual,settle_to_id,aliases,settle_status,deduction_amount,trash_cost,region,fee_rate_metro,fee_rate_regional,min_guarantee_enabled,min_guarantee_amount").order("name"),
      ]);
      setRows(d || []);
      setCompanies((c as Company[]) || []);
      setLeaders(sortLeadersByFeeAsc((l as Leader[]) || []));
    })();
  }, [month, refreshKey]);

  // 연간(12개월) 매출 요약용 — 기간 선택과 무관하게 항상 표시
  useEffect(() => {
    (async () => {
      const year = Number(month.slice(0, 4));
      if (!year) return;
      const yStart = `${year}-01-01`;
      const yEnd = `${year + 1}-01-01`;
      const { data } = await supabase
        .from("deliveries")
        .select("date,item,metro_fee,note_amount,regional_fee,company_id")
        .gte("date", yStart).lt("date", yEnd);
      setYearRows(data || []);
    })();
  }, [month, refreshKey]);

  const periodRows = useMemo(() => rows.filter((r) => inPeriod(r.date, period)), [rows, period]);

  const byId = useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);
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
  const samhoId = findId(["삼호"]);
  const samhoName = useMemo(() => leaders.find((l) => l.id === samhoId)?.name ?? "삼호", [leaders, samhoId]);

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
  const isCountable = (l: Leader | undefined): boolean =>
    !!l && l.active && !l.is_rejected && !l.is_virtual &&
    (l.settle_status ?? "included") !== "excluded" && !l.settle_to_id;

  // 행별 팀장 분배 (재분배 포함)
  const allocations = useMemo(() => {
    return periodRows.map((r) => {
      const shares = allocateRow({
        leader1_id: r.leader1_id, leader2_id: r.leader2_id, leader3_id: r.leader3_id,
        split_type: r.split_type, two_person: r.two_person,
        metro_fee: Number(r.metro_fee), note_amount: Number(r.note_amount),
        regional_fee: Number(r.regional_fee), cod_amount: Number(r.cod_amount),
      }, { shindongseokId, ganghyungjuId });
      const resolved = shares
        .map((s) => ({ ...s, target: resolveSettleId(s.leader_id) }))
        .filter((s) => isCountable(byId.get(s.target)));
      return { row: r, shares: resolved, hasValid: resolved.length > 0 };
    });
  }, [periodRows, byId, shindongseokId, ganghyungjuId]);
  const validRows = useMemo(() => allocations.filter((a) => a.hasValid), [allocations]);

  // ── 업체 배송비 총액 = 본사 총배송비(적재비 제외)와 동일
  const companyDeliveryTotal = useMemo(
    () => periodRows.reduce((s, r) => {
      if (((r.item as string) || "").trim() === "적재비") return s;
      return s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
    }, 0),
    [periodRows],
  );

  // ── 본사 직영 배송비 (신동석 + 삼호) — 본사 수익에 추가 가산
  // 재분배 포함 share 기준으로 두 팀장에게 귀속된 금액만 합산한다.
  const shindongseokFee = useMemo(() => {
    if (!shindongseokId) return 0;
    let sum = 0;
    for (const a of allocations) {
      if (((a.row.item as string) || "").trim() === "적재비") continue;
      for (const s of a.shares) {
        if (s.target === shindongseokId) sum += s.metro + s.note_amount + s.regional;
      }
    }
    return sum;
  }, [allocations, shindongseokId]);
  const samhoFee = useMemo(() => {
    if (!samhoId) return 0;
    let sum = 0;
    for (const a of allocations) {
      if (((a.row.item as string) || "").trim() === "적재비") continue;
      for (const s of a.shares) {
        if (s.target === samhoId) sum += s.metro + s.note_amount + s.regional;
      }
    }
    return sum;
  }, [allocations, samhoId]);
  const hqDirectFee = shindongseokFee + samhoFee;

  // ── 팀장 정산 상세
  type LeaderDetail = {
    id: string; name: string; count: number;
    fee: number; cod: number; commission: number; deduct: number; payout: number;
    minGuarantee: number; topUp: number;
  };
  const trashCostMultiplier = period === "all" ? 2 : 1;

  const leaderDetails = useMemo<LeaderDetail[]>(() => {
    const visible = leaders.filter(isCountable);
    const acc = new Map<string, { id: string; name: string; count: number; metro: number; note: number; regional: number; cod: number; commission: number; deduct: number; minGuarantee: number; minEnabled: boolean }>();
    for (const l of visible) {
      acc.set(l.id, {
        id: l.id, name: l.name, count: 0, metro: 0, note: 0, regional: 0, cod: 0, commission: 0,
        // 자동공제는 쓰레기비용만 고정. 월전체는 보름 2회 차감한다.
        deduct: Number(l.trash_cost || 0) * trashCostMultiplier,
        minGuarantee: Number(l.min_guarantee_amount || 0),
        minEnabled: !!l.min_guarantee_enabled,
      });
    }
    for (const { row, shares } of validRows) {
      // 적재비 행은 본사 적재비 수익(loadingBilled)에서 별도로 합산되므로
      // 팀장 정산(특히 삼호)에서는 중복 집계를 피하기 위해 제외한다.
      if (((row.item as string) || "").trim() === "적재비") continue;
      const counted = new Set<string>();
      for (const s of shares) {
        const b = acc.get(s.target);
        if (!b) continue;
        if (!counted.has(s.target)) { b.count += 1; counted.add(s.target); }
        b.metro += s.metro; b.note += s.note_amount; b.regional += s.regional; b.cod += s.cod;
        const lead = byId.get(s.target);
        const rateM = Number(lead?.fee_rate_metro || 0);
        const rateR = Number(lead?.fee_rate_regional || 0);
        // 행별 수수료 산출 후 합산 — 팀장정산 화면과 반올림 기준 일치
        b.commission += feeForShare({ metro: s.metro, regional: s.regional }, { metro: rateM, regional: rateR });
      }
    }
    return Array.from(acc.values()).map((x) => {
      const commission = x.commission;
      const fee = x.metro + x.note + x.regional;
      const rawPayout = fee - x.cod - commission - x.deduct;
      const payout = Math.max(0, rawPayout);
      // 최소보장 보전금은 클램프 전 실제 정산금을 기준으로 계산해야
      // 깊은 마이너스 정산에서도 정확한 보전이 이루어짐
      const topUp = x.minEnabled && x.minGuarantee > 0
        ? Math.max(0, x.minGuarantee - rawPayout) : 0;
      return {
        id: x.id, name: x.name, count: x.count,
        fee, cod: x.cod, commission, deduct: x.deduct, payout,
        minGuarantee: x.minGuarantee, topUp,
      };
    }).sort((a, b) => {
      const la = byId.get(a.id);
      const lb = byId.get(b.id);
      if (la && lb) return compareLeadersByFeeAsc(la, lb);
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [leaders, validRows, byId, trashCostMultiplier]);

  const leaderDeliveryTotal = leaderDetails.reduce((s, x) => s + x.fee, 0);
  // 팀장 수수료 합계 — 본사 수입으로 가산
  const leaderCommissionTotal = leaderDetails.reduce((s, x) => s + x.commission, 0);

  // 자동검증 (내부 관점) — 현재 기간 탭에 표시되는 행만 검사
  const audit = useMemo(
    () => auditDeliveries({
      deliveries: periodRows as any,
      companies,
      leaders: leaders as any,
      mode: "internal",
    }),
    [periodRows, companies, leaders],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  useArrowKeyNav(rootRef);

  // ── 업체 정산 상세
  type CompanyDetail = {
    id: string; name: string; count: number; fee: number;
    paidAmt: number; unpaidAmt: number; cod: number;
    prevCarry: number; netClaim: number; newCarry: number;
    issuesInvoice: boolean;
  };
  const companyDetails = useMemo<CompanyDetail[]>(() => {
    const visible = companies.filter((c) => c.active);
    return visible.map((c) => {
      const list = validRows.filter(
        ({ row: r }) => r.company_id === c.id || r.company_name === c.name,
      );
      const fee = list.reduce(
        (s, { row: r }) => s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee), 0,
      );
      const paidAmt = list.reduce(
        (s, { row: r }) => s + (r.paid ? Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee) : 0), 0,
      );
      const unpaidAmt = fee - paidAmt;
      const cod = list.reduce((s, { row: r }) => s + Number(r.cod_amount), 0);
      const prevCarry = Number(codCarry[c.id] || 0);
      const totalCod = cod + prevCarry;
      const netClaim = Math.max(0, unpaidAmt - totalCod);
      const newCarry = unpaidAmt < totalCod ? totalCod - unpaidAmt : 0;
      return {
        id: c.id, name: c.name, count: list.length, fee,
        paidAmt, unpaidAmt, cod, prevCarry, netClaim, newCarry,
        issuesInvoice: c.issues_invoice,
      };
    }).filter((x) => x.count > 0 || x.prevCarry > 0)
      .sort((a, b) => b.fee - a.fee);
  }, [companies, validRows, codCarry]);

  // ── 적재비 합계
  const loadingTotal = loadingCosts.reduce((s, x) => s + Number(x.amount || 0), 0);
  const loadingBilled = loadingCosts.reduce((s, x) => s + (x.billed === "billed" ? Number(x.amount || 0) : 0), 0);
  const loadingUnbilled = loadingTotal - loadingBilled;

  // 자동등록된 적재비(배송 행)는 이미 companyDeliveryTotal 에 포함되므로
  // grossSales 계산 시 중복 집계를 피하려면 미등록분만 별도로 더한다.
  const registeredLoadingKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (((r.item as string) || "").trim() === "적재비" && r.company_id) {
        set.add(`${r.date}|${r.company_id}`);
      }
    }
    return set;
  }, [rows]);
  const unregisteredLoadingTotal = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    return loadingCosts.reduce((s, lc) => {
      if (!lc.company_id || !lc.amount) return s;
      const day = Math.min(Math.max(Number(lc.day) || 1, 1), lastDay);
      const key = `${month}-${pad(day)}|${lc.company_id}`;
      return registeredLoadingKeys.has(key) ? s : s + Number(lc.amount || 0);
    }, 0);
  }, [loadingCosts, registeredLoadingKeys, month]);

  // 같은 달 동일 업체 적재비 중복 청구 검사
  const dupLoadingCompanies = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const lc of loadingCosts) {
      if (lc.billed !== "billed" || !lc.company_id) continue;
      cnt.set(lc.company_id, (cnt.get(lc.company_id) || 0) + 1);
    }
    const dups: string[] = [];
    for (const [cid, n] of cnt) if (n > 1) {
      const c = companies.find((x) => x.id === cid);
      if (c) dups.push(c.name);
    }
    return dups;
  }, [loadingCosts, companies]);

  // ── 최저보장보전금 (이름 노출 없음 — 합계만)
  const minGuaranteeTopUp = useMemo(
    () => leaderDetails.reduce((s, x) => s + (x.topUp || 0), 0),
    [leaderDetails],
  );

  // ── 지출합계
  const fixedTotal = FIXED_LABELS.reduce((s, x) => s + Number(expenses[x.key] || 0), 0);
  const additionalTotal = expenses.additional.reduce((s, x) => s + Number(x.amount || 0), 0);
  const expenseTotal = fixedTotal + additionalTotal + minGuaranteeTopUp;

  // ── 본사 총배송비 (참고용, 계산 미포함) — 적재비 행은 제외
  const totalDeliveryFee = periodRows.reduce(
    (s, r) => {
      if (((r.item as string) || "").trim() === "적재비") return s;
      return s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
    }, 0,
  );

  // ── 월전체 본사 총배송비 (적재비 제외)
  const monthlyDeliveryFee = rows.reduce(
    (s, r) => {
      if (((r.item as string) || "").trim() === "적재비") return s;
      return s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
    }, 0,
  );

  // ── 연간(12개월) 총매출 — 기간/월 선택과 무관하게 항상 표시
  const yearLabel = month.slice(0, 4);
  const yearCompanyDeliveryTotal = useMemo(
    () => yearRows.reduce((s, r) => {
      if (((r.item as string) || "").trim() === "적재비") return s;
      return s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
    }, 0),
    [yearRows],
  );
  const yearLoadingTotal = useMemo(
    () => yearRows.reduce((s, r) => {
      if (((r.item as string) || "").trim() !== "적재비") return s;
      return s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
    }, 0),
    [yearRows],
  );
  const yearGrossSales = yearCompanyDeliveryTotal + yearLoadingTotal;

  // ── 월별 매출 (1~12월): 업체 총배송비 / 적재비 / 합계
  const yearMonthly = useMemo(() => {
    const arr = Array.from({ length: 12 }, () => ({ company: 0, loading: 0 }));
    for (const r of yearRows) {
      const m = Number((r.date || "").slice(5, 7));
      if (!m || m < 1 || m > 12) continue;
      const amt = Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
      const isLoading = ((r.item as string) || "").trim() === "적재비";
      if (isLoading) arr[m - 1].loading += amt;
      else arr[m - 1].company += amt;
    }
    return arr;
  }, [yearRows]);

  // ── 매출 / 수익
  // 본사 수익 = 신동석 + 삼호 + 적재비(청구분만) + 수수료
  const grossSales = hqDirectFee + loadingBilled + leaderCommissionTotal;
  const hqProfit = grossSales - expenseTotal;

  // 업체정산관리 요약
  const filteredCompanies = useMemo(() => {
    return companyDetails.map((c) => {
      const status = companyStatus[c.id] ?? "unpaid";
      return { ...c, status };
    }).filter((c) => companyFilter === "all" ? true : c.status === companyFilter);
  }, [companyDetails, companyStatus, companyFilter]);

  // 팀장정산관리 필터링
  const filteredLeaders = useMemo(() => {
    return leaderDetails.map((l) => {
      const status = leaderStatus[l.id] ?? "pending";
      return { ...l, status };
    }).filter((l) => leaderFilter === "all" ? true : l.status === leaderFilter);
  }, [leaderDetails, leaderStatus, leaderFilter]);

  // 적재비 추가
  const addLoading = () => setLoadingCosts((p) => [...p, {
    id: crypto.randomUUID(), day: 1, company_id: companies[0]?.id ?? "", amount: 0,
    billed: "billed", invoice: "issued",
  }]);
  const updateLoading = (id: string, patch: Partial<LoadingCost>) =>
    setLoadingCosts((p) => p.map((x) => x.id === id ? { ...x, ...patch } : x));
  const removeLoading = (id: string) =>
    setLoadingCosts((p) => p.filter((x) => x.id !== id));

  // ── 적재비 자동등록: 해당 업체에 (팀장=삼호, 품목=적재비, 금액=입력 금액) 배송 행을 생성
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const autoRegisterLoading = async (lc: LoadingCost): Promise<{ ok: boolean; reason?: string }> => {
    if (!user?.id) return { ok: false, reason: "로그인 필요" };
    if (!lc.company_id) return { ok: false, reason: "업체 미지정" };
    if (!lc.day || lc.day < 1 || lc.day > 31) return { ok: false, reason: "날짜 오류" };
    if (!lc.amount || lc.amount <= 0) return { ok: false, reason: "금액 0" };
    if (!samhoId) return { ok: false, reason: "팀장 '삼호' 없음" };
    const company = companies.find((c) => c.id === lc.company_id);
    if (!company) return { ok: false, reason: "업체 없음" };
    // 해당 달의 실제 마지막 일자로 보정
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const day = Math.min(lc.day, lastDay);
    const dateStr = `${month}-${pad2(day)}`;
    // 중복 검사
    const { data: existing } = await supabase
      .from("deliveries")
      .select("id")
      .eq("user_id", user.id)
      .eq("date", dateStr)
      .eq("company_id", lc.company_id)
      .eq("item", "적재비")
      .limit(1);
    if (existing && existing.length > 0) return { ok: false, reason: "이미 등록됨" };
    const { error } = await supabase.from("deliveries").insert({
      user_id: user.id,
      date: dateStr,
      company_id: company.id,
      company_name: company.name,
      leader1_id: samhoId,
      leader1_name: samhoName,
      item: "적재비",
      metro_fee: 0,
      regional_fee: 0,
      note_amount: Number(lc.amount),
      cod_amount: 0,
      note: "적재비 자동등록",
    } as any);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  };
  const handleAutoRegisterOne = async (lc: LoadingCost) => {
    const r = await autoRegisterLoading(lc);
    if (r.ok) {
      toast({ title: "자동등록 완료", description: `${companies.find((c) => c.id === lc.company_id)?.name ?? ""} · ${month}-${pad2(lc.day)} · ${fmt(lc.amount)}` });
      setRefreshKey((k) => k + 1);
    } else {
      toast({ title: "자동등록 실패", description: r.reason, variant: "destructive" });
    }
  };
  const handleAutoRegisterAll = async () => {
    if (loadingCosts.length === 0) {
      toast({ title: "등록할 적재비 없음", variant: "destructive" });
      return;
    }
    let ok = 0, skip = 0, fail = 0;
    const failReasons: string[] = [];
    for (const lc of loadingCosts) {
      const r = await autoRegisterLoading(lc);
      if (r.ok) ok++;
      else if (r.reason === "이미 등록됨") skip++;
      else { fail++; failReasons.push(r.reason || "오류"); }
    }
    setRefreshKey((k) => k + 1);
    toast({
      title: "전체 자동등록 결과",
      description: `성공 ${ok}건 · 중복 ${skip}건 · 실패 ${fail}건${failReasons.length ? ` (${[...new Set(failReasons)].join(", ")})` : ""}`,
      variant: fail > 0 ? "destructive" : "default",
    });
  };

  const setAdditional = (idx: number, patch: Partial<{ date: string; label: string; amount: number; note: string }>) =>
    setExpenses((p) => ({
      ...p,
      additional: p.additional.map((x, i) => i === idx ? { ...x, ...patch } : x),
    }));
  const addAdditional = () =>
    setExpenses((p) => ({
      ...p,
      additional: [...p.additional, { id: crypto.randomUUID(), date: "", label: "", amount: 0, note: "" }],
    }));
  const removeAdditional = (idx: number) =>
    setExpenses((p) => ({
      ...p,
      additional: p.additional.filter((_, i) => i !== idx),
    }));

  return (
    <div className="space-y-4" ref={rootRef}>
      {/* 헤더 */}
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex-1 min-w-full sm:min-w-0 whitespace-nowrap">본사정산</h1>
        <PrintButton documentTitle={`본사정산_${month}`} />
        <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); }} className="w-40" />
        <Tabs value={period} onValueChange={(v) => { setPeriod(v as Period); }}>
          <TabsList>
            <TabsTrigger value="all">월전체</TabsTrigger>
            <TabsTrigger value="h1">1~15일</TabsTrigger>
            <TabsTrigger value="h2">16~말일</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-muted-foreground">날짜 자동</span>
          <Switch checked={autoPeriod} onCheckedChange={toggleAutoPeriod} />
        </div>
      </div>

      <AuditBanner title="자동검증 (계산서·거부업체·제출문구)" result={audit} defaultOpen={!audit.ok} />

      {/* 본사 연간 총매출 — 12개월 누계, 기간 선택 무관 */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold bg-muted/40 flex items-center justify-between">
          <span>본사 총매출 ({yearLabel}년 1~12월 합계)</span>
          <span className="text-xs text-muted-foreground font-normal">
            기간 선택과 무관하게 항상 연간 합계로 표시
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x text-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-muted-foreground">업체 총배송비</span>
            <span className="font-medium">{fmt(yearCompanyDeliveryTotal)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-muted-foreground">적재비</span>
            <span className="font-medium">{fmt(yearLoadingTotal)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
            <span className="font-semibold">본사 총매출</span>
            <span className="font-bold text-destructive">{fmt(yearGrossSales)}</span>
          </div>
        </div>
      </Card>

      {/* 상단: 본사 수익 요약 + 적재비 입력 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold bg-muted/40">본사 수익 요약</div>
          <div className="divide-y text-sm">
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">본사 총배송비</span>
              <span className="font-medium text-destructive">{fmt(totalDeliveryFee)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">적재비 (청구분)</span>
              <span className="font-medium">{fmt(loadingBilled)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">신동석 배송비</span>
              <span className="font-medium">{fmt(shindongseokFee)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">삼호 배송비</span>
              <span className="font-medium">{fmt(samhoFee)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">수수료</span>
              <span className="font-medium">{fmt(leaderCommissionTotal)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">지출합계</span>
              <span className="font-medium text-destructive">{expenseTotal ? `-${fmt(expenseTotal)}` : "0"}</span>
            </div>
            <div className="flex justify-between px-4 py-3 bg-muted/30">
              <span className="font-semibold">최종 본사 수익</span>
              <span className="font-bold text-destructive">{fmt(hqProfit)}</span>
            </div>
            <div className="px-4 py-2 bg-muted/20 text-xs text-muted-foreground text-center">
              (신동석 {fmt(shindongseokFee)} + 삼호 {fmt(samhoFee)} + 적재비(청구) {fmt(loadingBilled)} + 수수료 {fmt(leaderCommissionTotal)}) - 총지출 {fmt(expenseTotal)} = {fmt(hqProfit)}
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-3 overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold flex items-center gap-2">
            적재비 입력
            <span className="text-xs text-muted-foreground">청구 {fmt(loadingBilled)} · 미청구 {fmt(loadingUnbilled)} · 합계 {fmt(loadingTotal)}</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="default" onClick={handleAutoRegisterAll} disabled={!samhoId} title={samhoId ? "" : "팀장 '삼호' 등록 필요"}>
                전체 자동등록
              </Button>
              <Button size="sm" variant="outline" onClick={addLoading}>
                <Plus className="w-4 h-4 mr-1" />추가
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table className="text-sm min-w-max">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center" style={{ minWidth: 110, width: 110 }}>날짜</TableHead>
                  <TableHead className="text-center" style={{ minWidth: 140, width: 140 }}>업체</TableHead>
                  <TableHead className="text-center" style={{ minWidth: 130, width: 130 }}>금액</TableHead>
                  <TableHead className="text-center" style={{ minWidth: 110, width: 110 }}>청구여부</TableHead>
                  <TableHead className="text-center" style={{ minWidth: 110, width: 110 }}>계산서</TableHead>
                  <TableHead className="text-center" style={{ minWidth: 110, width: 110 }}>자동등록</TableHead>
                  <TableHead className="text-center" style={{ width: 50 }}></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingCosts.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">적재비 입력 없음</TableCell></TableRow>
                )}
                {loadingCosts.map((lc) => (
                  <TableRow key={lc.id}>
                    <TableCell className="text-center">
                      <Input type="number" min={1} max={31} value={lc.day || ""} className="h-8 w-16 text-center mx-auto"
                        onChange={(e) => updateLoading(lc.id, { day: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Select value={lc.company_id} onValueChange={(v) => updateLoading(lc.id, { company_id: v })}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="업체 선택" /></SelectTrigger>
                        <SelectContent>
                          {companies.filter((c) => c.active).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      <AmountInput value={lc.amount} className="h-8 text-center"
                        onChange={(n) => updateLoading(lc.id, { amount: n })} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Select value={lc.billed} onValueChange={(v) => updateLoading(lc.id, { billed: v as "billed" | "unbilled" })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="billed">청구</SelectItem>
                          <SelectItem value="unbilled">미청구</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      <Select value={lc.invoice} onValueChange={(v) => updateLoading(lc.id, { invoice: v as "issued" | "not_issued" })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="issued">발행</SelectItem>
                          <SelectItem value="not_issued">미발행</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={!samhoId || !lc.company_id || !lc.amount}
                        title={!samhoId ? "팀장 '삼호' 미등록" : ""}
                        onClick={() => handleAutoRegisterOne(lc)}
                      >
                        등록
                      </Button>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLoading(lc.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {dupLoadingCompanies.length > 0 && (
            <div className="p-3 text-xs text-destructive border-t">
              ⚠ 같은 달 적재비가 중복 청구된 업체: {dupLoadingCompanies.join(", ")}
            </div>
          )}
        </Card>
      </div>

      {/* 3분할: 지출 / 팀장 / 업체 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 지출관리 */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold flex items-center justify-between">
            <div className="flex flex-col">
              <span>지출관리</span>
              <span className="text-xs text-muted-foreground font-normal">
                고정지출 {fmt(fixedTotal)} + 추가지출 {fmt(additionalTotal)} + 최저보장보전금 {fmt(minGuaranteeTopUp)} = {fmt(expenseTotal)}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs font-medium">총지출 {fmt(expenseTotal)}</span>
              <Button size="sm" variant="outline" onClick={addAdditional}>
                <Plus className="w-4 h-4 mr-1" />추가
              </Button>
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            <Table className="text-xs w-full table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center px-1" style={{ width: "38%" }}>지출내용</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "22%" }}>금액</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "32%" }}>비고</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "8%" }}></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {FIXED_LABELS.map((f) => (
                  <TableRow key={f.key}>
                    <TableCell className="text-center whitespace-nowrap">{f.label}</TableCell>
                    <TableCell className="text-center">
                      <AmountInput value={expenses[f.key]} className="h-8 text-center"
                        onChange={(n) => setExpenses((p) => ({ ...p, [f.key]: n }))} />
                    </TableCell>
                    <TableCell className="text-center"></TableCell>
                    <TableCell className="text-center"></TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell className="text-center whitespace-nowrap">최저보장보전금</TableCell>
                  <TableCell className="text-center">
                    <Input value={minGuaranteeTopUp ? `-${fmt(minGuaranteeTopUp)}` : "0"} readOnly className="h-8 text-center bg-background" />
                  </TableCell>
                  <TableCell className="text-center text-xs text-muted-foreground">자동 계산</TableCell>
                  <TableCell className="text-center"></TableCell>
                </TableRow>
                {expenses.additional.map((a, i) => (
                  <TableRow key={a.id ?? i}>
                    <TableCell className="text-center">
                      <Input placeholder="지출내용" value={a.label} className="h-8 text-center"
                        onChange={(e) => setAdditional(i, { label: e.target.value })} />
                    </TableCell>
                    <TableCell className="text-center">
                      <AmountInput value={a.amount} className="h-8 text-center"
                        onChange={(n) => setAdditional(i, { amount: n })} />
                    </TableCell>
                    <TableCell className="text-center align-middle">
                      <Textarea
                        placeholder="비고"
                        value={a.note || ""}
                        rows={2}
                        className="min-h-[40px] text-center resize-y break-words whitespace-pre-wrap"
                        onChange={(e) => setAdditional(i, { note: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeAdditional(i)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {expenses.additional.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-4 text-xs">
                      추가 버튼으로 지출 항목을 입력하세요.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* 팀장정산관리 */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold flex items-center gap-2">
            팀장정산관리
            <Tabs value={leaderFilter} onValueChange={(v) => setLeaderFilter(v as any)} className="ml-auto">
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs">전체</TabsTrigger>
                <TabsTrigger value="settled" className="text-xs">정산완료</TabsTrigger>
                <TabsTrigger value="pending" className="text-xs">미정산</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            <Table className="text-xs num w-full table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center px-1" style={{ width: "13%" }}>팀장명</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "9%" }}>건수</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "14%" }}>배송비</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "12%" }}>착불</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "12%" }}>수수료</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "11%" }}>공제</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "14%" }}>실지급</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "15%" }}>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeaders.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">표시할 팀장이 없습니다.</TableCell></TableRow>
                )}
                {filteredLeaders.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-center truncate px-1">{l.name}</TableCell>
                    <TableCell className="text-center px-1">{l.count}</TableCell>
                    <TableCell className="text-center px-1">{fmt(l.fee)}</TableCell>
                    <TableCell className="text-center px-1">{fmt(l.cod)}</TableCell>
                    <TableCell className="text-center px-1">{fmt(l.commission)}</TableCell>
                    <TableCell className="text-center px-1">{fmt(l.deduct)}</TableCell>
                    <TableCell className="text-center font-semibold px-1">{fmt(l.payout)}</TableCell>
                    <TableCell className="text-center px-1">
                      <Select value={l.status} onValueChange={(v) => setLeaderStatus((p) => ({ ...p, [l.id]: v as "settled" | "pending" }))}>
                        <SelectTrigger className="h-7 px-1 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="settled">정산완료</SelectItem>
                          <SelectItem value="pending">미정산</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* 업체정산관리 */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold flex items-center gap-2">
            업체정산관리
            <Tabs value={companyFilter} onValueChange={(v) => setCompanyFilter(v as any)} className="ml-auto">
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs">전체</TabsTrigger>
                <TabsTrigger value="paid" className="text-xs">결제완료</TabsTrigger>
                <TabsTrigger value="unpaid" className="text-xs">미결제</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            <Table className="text-xs num w-full table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center px-1" style={{ width: "16%" }}>업체명</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "8%" }}>건수</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "13%" }}>배송비</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "12%" }}>미결제</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "11%" }}>착불</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "12%" }}>이월</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "13%" }}>실청구</TableHead>
                  <TableHead className="text-center px-1" style={{ width: "15%" }}>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">표시할 업체가 없습니다.</TableCell></TableRow>
                )}
                {filteredCompanies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-center truncate px-1">
                      {c.name}
                      {!c.issuesInvoice && <Badge variant="outline" className="ml-1 text-xs">계산서 미발행</Badge>}
                    </TableCell>
                    <TableCell className="text-center px-1">{c.count}</TableCell>
                    <TableCell className="text-center px-1">{fmt(c.fee)}</TableCell>
                    <TableCell className="text-center px-1">{fmt(c.unpaidAmt)}</TableCell>
                    <TableCell className="text-center px-1">{fmt(c.cod)}</TableCell>
                    <TableCell className="text-center px-1">
                      <AmountInput value={c.prevCarry} className="h-7 text-center w-full px-1 text-xs"
                        onChange={(n) => setCodCarry((p) => ({ ...p, [c.id]: n }))} />
                    </TableCell>
                    <TableCell className="text-center font-semibold px-1">{fmt(c.netClaim)}</TableCell>
                    <TableCell className="text-center px-1">
                      <Select value={c.status} onValueChange={(v) => setCompanyStatus((p) => ({ ...p, [c.id]: v as "paid" | "unpaid" }))}>
                        <SelectTrigger className="h-7 px-1 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="paid">결제완료</SelectItem>
                          <SelectItem value="unpaid">미결제</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

    </div>
  );
}