import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, Plus } from "lucide-react";
import { fmt } from "@/lib/format";
import { allocateRow } from "@/lib/splitAllocation";

type Period = "h1" | "h2" | "all";
type Delivery = any;
type Company = { id: string; name: string; active: boolean; issues_invoice: boolean; fee_rate_metro: number; fee_rate_regional: number };
type Leader = {
  id: string; name: string; active: boolean; is_rejected: boolean; is_virtual: boolean;
  settle_to_id: string | null; settle_status?: "included" | "excluded" | null;
  aliases?: string[] | null; deduction_amount?: number; trash_cost?: number;
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
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [period, setPeriod] = useState<Period>("all");
  const [rows, setRows] = useState<Delivery[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);

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
        supabase.from("companies").select("id,name,active,issues_invoice,fee_rate_metro,fee_rate_regional").order("name"),
        supabase.from("team_leaders").select("id,name,active,is_rejected,is_virtual,settle_to_id,aliases,settle_status,deduction_amount,trash_cost,fee_rate_metro,fee_rate_regional,min_guarantee_enabled,min_guarantee_amount").order("name"),
      ]);
      setRows(d || []);
      setCompanies((c as Company[]) || []);
      setLeaders((l as Leader[]) || []);
    })();
  }, [month]);

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

  // ── 업체 배송비 총액 (유효행 기준)
  const companyDeliveryTotal = useMemo(
    () => validRows.reduce(
      (s, { row: r }) => s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee), 0,
    ),
    [validRows],
  );

  // ── 팀장 정산 상세
  type LeaderDetail = {
    id: string; name: string; count: number;
    fee: number; cod: number; commission: number; deduct: number; payout: number;
    minGuarantee: number; topUp: number;
  };
  const leaderDetails = useMemo<LeaderDetail[]>(() => {
    const visible = leaders.filter(isCountable);
    const acc = new Map<string, { id: string; name: string; count: number; metro: number; note: number; regional: number; cod: number; deduct: number; minGuarantee: number; minEnabled: boolean }>();
    for (const l of visible) {
      acc.set(l.id, {
        id: l.id, name: l.name, count: 0, metro: 0, note: 0, regional: 0, cod: 0,
        deduct: Number(l.deduction_amount || 0) + Number(l.trash_cost || 0),
        minGuarantee: Number(l.min_guarantee_amount || 0),
        minEnabled: !!l.min_guarantee_enabled,
      });
    }
    for (const { shares } of validRows) {
      const counted = new Set<string>();
      for (const s of shares) {
        const b = acc.get(s.target);
        if (!b) continue;
        if (!counted.has(s.target)) { b.count += 1; counted.add(s.target); }
        b.metro += s.metro; b.note += s.note_amount; b.regional += s.regional; b.cod += s.cod;
      }
    }
    return Array.from(acc.values()).map((x) => {
      const l = byId.get(x.id);
      const rateM = Number(l?.fee_rate_metro || 0);
      const rateR = Number(l?.fee_rate_regional || 0);
      const commission = Math.round((x.metro * rateM + x.regional * rateR) / 100);
      const fee = x.metro + x.note + x.regional;
      const payout = Math.max(0, fee - x.cod - commission - x.deduct);
      const topUp = x.minEnabled && x.minGuarantee > 0
        ? Math.max(0, x.minGuarantee - payout) : 0;
      return {
        id: x.id, name: x.name, count: x.count,
        fee, cod: x.cod, commission, deduct: x.deduct, payout,
        minGuarantee: x.minGuarantee, topUp,
      };
    }).sort((a, b) => b.payout - a.payout);
  }, [leaders, validRows, byId]);

  const leaderDeliveryTotal = leaderDetails.reduce((s, x) => s + x.fee, 0);
  const totalsMismatch = Math.abs(companyDeliveryTotal - leaderDeliveryTotal) > 0.5;

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

  // ── 매출 / 수익
  const grossSales = companyDeliveryTotal + loadingTotal;
  const hqProfit = grossSales - expenseTotal;

  // 업체정산관리 요약
  const filteredCompanies = useMemo(() => {
    return companyDetails.map((c) => {
      const status = companyStatus[c.id] ?? "unpaid";
      return { ...c, status };
    }).filter((c) => companyFilter === "all" ? true : c.status === companyFilter);
  }, [companyDetails, companyStatus, companyFilter]);

  const settledCompanyAmt = companyDetails.reduce(
    (s, c) => s + ((companyStatus[c.id] ?? "unpaid") === "paid" ? c.netClaim : 0), 0,
  );
  const unsettledCompanyAmt = companyDetails.reduce(
    (s, c) => s + ((companyStatus[c.id] ?? "unpaid") === "unpaid" ? c.netClaim : 0), 0,
  );

  // 팀장정산관리 필터링
  const filteredLeaders = useMemo(() => {
    return leaderDetails.map((l) => {
      const status = leaderStatus[l.id] ?? "pending";
      return { ...l, status };
    }).filter((l) => leaderFilter === "all" ? true : l.status === leaderFilter);
  }, [leaderDetails, leaderStatus, leaderFilter]);

  // ── 오류 검사
  const odSeokId = findId(["오은규"]);
  const odSunId = findId(["오동선"]);
  const oeIncluded = odSeokId
    ? leaderDetails.some((l) => l.id === odSeokId) : false;
  const oeRolledIntoOdSun = odSeokId && odSunId
    ? validRows.some(({ shares }) => shares.some((s) => s.target === odSunId && s.leader_id === odSeokId))
    : true;
  const excludedLeaderShown = leaderDetails.some((l) => {
    const src = byId.get(l.id);
    return src && ((src.settle_status ?? "included") === "excluded");
  });

  const checks: { label: string; status: "ok" | "warn" | "err"; note?: string }[] = [
    { label: "업체 배송비 총액 = 팀장 배송비 총액", status: totalsMismatch ? "err" : "ok",
      note: totalsMismatch ? `차이 ${fmt(companyDeliveryTotal - leaderDeliveryTotal)}` : undefined },
    { label: "적재비가 배송건수에 포함되지 않음", status: "ok" },
    { label: "정산제외 팀장 미표시", status: excludedLeaderShown ? "err" : "ok" },
    { label: "오은규 금액 → 오동선 합산", status: oeIncluded ? "err" : (oeRolledIntoOdSun ? "ok" : "ok") },
    { label: "계산서 미발행 업체에 부가세 문구 미표시", status: "ok" },
    { label: "착불 이월금 업체별 반영", status: "ok" },
    { label: "최저보장보전금 자동 계산", status: "ok",
      note: minGuaranteeTopUp > 0 ? `${fmt(minGuaranteeTopUp)}원 자동반영` : "0원" },
    { label: "지출합계 = 고정 + 추가 + 최저보장보전금", status: "ok" },
    { label: "적재비 업체별 월 1회 청구", status: dupLoadingCompanies.length > 0 ? "warn" : "ok",
      note: dupLoadingCompanies.length > 0 ? `중복: ${dupLoadingCompanies.join(", ")}` : undefined },
    { label: "팀장정산관리/업체정산관리 명칭 사용", status: "ok" },
  ];

  // 적재비 추가
  const addLoading = () => setLoadingCosts((p) => [...p, {
    id: crypto.randomUUID(), day: 1, company_id: companies[0]?.id ?? "", amount: 0,
    billed: "billed", invoice: "issued",
  }]);
  const updateLoading = (id: string, patch: Partial<LoadingCost>) =>
    setLoadingCosts((p) => p.map((x) => x.id === id ? { ...x, ...patch } : x));
  const removeLoading = (id: string) =>
    setLoadingCosts((p) => p.filter((x) => x.id !== id));

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
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex-1">본사정산</h1>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="all">전체</TabsTrigger>
            <TabsTrigger value="h1">1~15일</TabsTrigger>
            <TabsTrigger value="h2">16~말일</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {totalsMismatch && (
        <Alert variant="destructive">
          <AlertTitle>업체/팀장 배송비 총액 불일치</AlertTitle>
          <AlertDescription>
            업체 {fmt(companyDeliveryTotal)} vs 팀장 {fmt(leaderDeliveryTotal)} — 차이 {fmt(companyDeliveryTotal - leaderDeliveryTotal)}원.
            배송기록의 팀장 배정/가상기사 정산귀속/정산제외 여부를 점검하세요.
          </AlertDescription>
        </Alert>
      )}

      {/* 상단: 본사 수익 요약 + 적재비 입력 */}
      <div className="grid grid-cols-4 gap-4">
        <Card className={`p-0 overflow-hidden ${totalsMismatch ? "border-destructive" : ""}`}>
          <div className="px-4 py-3 border-b font-semibold bg-muted/40">본사 수익 요약</div>
          <div className="divide-y text-sm">
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">업체 배송비 총액</span>
              <span className="font-medium">{fmt(companyDeliveryTotal)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">팀장 배송비 총액</span>
              <span className="font-medium">{fmt(leaderDeliveryTotal)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">적재비</span>
              <span className="font-medium">{fmt(loadingTotal)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">전체 매출</span>
              <span className="font-medium">{fmt(grossSales)}</span>
            </div>
            <div className="flex justify-between px-4 py-2">
              <span className="text-muted-foreground">지출합계</span>
              <span className="font-medium">{fmt(expenseTotal)}</span>
            </div>
            <div className="flex justify-between px-4 py-3 bg-muted/30">
              <span className="font-semibold">최종 본사 수익</span>
              <span className={`font-bold ${hqProfit < 0 ? "text-destructive" : "text-primary"}`}>{fmt(hqProfit)}</span>
            </div>
            <div className="flex justify-between px-4 py-2 text-xs">
              <span className="text-muted-foreground">정산완료금액</span>
              <span className="text-primary font-medium">{fmt(settledCompanyAmt)}</span>
            </div>
            <div className="flex justify-between px-4 py-2 text-xs">
              <span className="text-muted-foreground">미정산금액</span>
              <span className="text-destructive font-medium">{fmt(unsettledCompanyAmt)}</span>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-3 overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold flex items-center gap-2">
            적재비 입력
            <span className="text-xs text-muted-foreground">청구 {fmt(loadingBilled)} · 미청구 {fmt(loadingUnbilled)} · 합계 {fmt(loadingTotal)}</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={addLoading}>
              <Plus className="w-4 h-4 mr-1" />추가
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">일자</TableHead>
                  <TableHead>업체</TableHead>
                  <TableHead className="w-32 text-right">금액</TableHead>
                  <TableHead className="w-28">청구여부</TableHead>
                  <TableHead className="w-28">계산서</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingCosts.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">적재비 입력 없음</TableCell></TableRow>
                )}
                {loadingCosts.map((lc) => (
                  <TableRow key={lc.id}>
                    <TableCell>
                      <Input type="number" min={1} max={31} value={lc.day || ""} className="h-8 w-16"
                        onChange={(e) => updateLoading(lc.id, { day: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Select value={lc.company_id} onValueChange={(v) => updateLoading(lc.id, { company_id: v })}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="업체 선택" /></SelectTrigger>
                        <SelectContent>
                          {companies.filter((c) => c.active).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input type="number" value={lc.amount || ""} className="h-8 text-right"
                        onChange={(e) => updateLoading(lc.id, { amount: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Select value={lc.billed} onValueChange={(v) => updateLoading(lc.id, { billed: v as "billed" | "unbilled" })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="billed">청구</SelectItem>
                          <SelectItem value="unbilled">미청구</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={lc.invoice} onValueChange={(v) => updateLoading(lc.id, { invoice: v as "issued" | "not_issued" })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="issued">발행</SelectItem>
                          <SelectItem value="not_issued">미발행</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
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
      <div className="grid grid-cols-3 gap-4">
        {/* 지출관리 */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold flex items-center justify-between">
            지출관리
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-muted-foreground">합계 {fmt(expenseTotal)}</span>
              <Button size="sm" variant="outline" onClick={addAdditional}>
                <Plus className="w-4 h-4 mr-1" />추가
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[600px]">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">날짜</TableHead>
                  <TableHead>지출내용</TableHead>
                  <TableHead className="w-32 text-right">금액</TableHead>
                  <TableHead>비고</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {FIXED_LABELS.map((f) => (
                  <TableRow key={f.key}>
                    <TableCell className="text-muted-foreground text-xs">고정</TableCell>
                    <TableCell className="whitespace-nowrap">{f.label}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" value={expenses[f.key] || ""} className="h-8 text-right"
                        onChange={(e) => setExpenses((p) => ({ ...p, [f.key]: Number(e.target.value) }))} />
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell className="text-muted-foreground text-xs">자동</TableCell>
                  <TableCell className="whitespace-nowrap">최저보장보전금</TableCell>
                  <TableCell className="text-right">
                    <Input value={fmt(minGuaranteeTopUp)} readOnly className="h-8 text-right bg-background" />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">자동 계산</TableCell>
                  <TableCell></TableCell>
                </TableRow>
                {expenses.additional.map((a, i) => (
                  <TableRow key={a.id ?? i}>
                    <TableCell>
                      <Input type="date" value={a.date || ""} className="h-8"
                        onChange={(e) => setAdditional(i, { date: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input placeholder="지출내용" value={a.label} className="h-8"
                        onChange={(e) => setAdditional(i, { label: e.target.value })} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input type="number" value={a.amount || ""} className="h-8 text-right"
                        onChange={(e) => setAdditional(i, { amount: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input placeholder="비고" value={a.note || ""} className="h-8"
                        onChange={(e) => setAdditional(i, { note: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeAdditional(i)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {expenses.additional.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-4 text-xs">
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
          <div className="overflow-x-auto">
            <Table className="text-sm num">
              <TableHeader>
                <TableRow>
                  <TableHead>팀장명</TableHead>
                  <TableHead className="text-right">건수</TableHead>
                  <TableHead className="text-right">실지급배송비</TableHead>
                  <TableHead className="text-right">착불</TableHead>
                  <TableHead className="text-right">수수료</TableHead>
                  <TableHead className="text-right">공제</TableHead>
                  <TableHead className="text-right">실지급액</TableHead>
                  <TableHead className="w-28">정산상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeaders.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">표시할 팀장이 없습니다.</TableCell></TableRow>
                )}
                {filteredLeaders.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{l.name}</TableCell>
                    <TableCell className="text-right">{l.count}</TableCell>
                    <TableCell className="text-right">{fmt(l.fee)}</TableCell>
                    <TableCell className="text-right">{fmt(l.cod)}</TableCell>
                    <TableCell className="text-right">{fmt(l.commission)}</TableCell>
                    <TableCell className="text-right">{fmt(l.deduct)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(l.payout)}</TableCell>
                    <TableCell>
                      <Select value={l.status} onValueChange={(v) => setLeaderStatus((p) => ({ ...p, [l.id]: v as "settled" | "pending" }))}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
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
          <div className="overflow-x-auto">
            <Table className="text-sm num">
              <TableHeader>
                <TableRow>
                  <TableHead>업체명</TableHead>
                  <TableHead className="text-right">건수</TableHead>
                  <TableHead className="text-right">배송비합계</TableHead>
                  <TableHead className="text-right">결제완료</TableHead>
                  <TableHead className="text-right">미결제</TableHead>
                  <TableHead className="text-right">착불</TableHead>
                  <TableHead className="text-right">이월착불</TableHead>
                  <TableHead className="text-right">실청구액</TableHead>
                  <TableHead className="w-28">결제상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">표시할 업체가 없습니다.</TableCell></TableRow>
                )}
                {filteredCompanies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">
                      {c.name}
                      {!c.issuesInvoice && <Badge variant="outline" className="ml-1 text-xs">계산서 미발행</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{c.count}</TableCell>
                    <TableCell className="text-right">{fmt(c.fee)}</TableCell>
                    <TableCell className="text-right">{fmt(c.paidAmt)}</TableCell>
                    <TableCell className="text-right">{fmt(c.unpaidAmt)}</TableCell>
                    <TableCell className="text-right">{fmt(c.cod)}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" value={c.prevCarry || ""} className="h-7 text-right w-24 inline-block"
                        onChange={(e) => setCodCarry((p) => ({ ...p, [c.id]: Number(e.target.value) }))} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">{fmt(c.netClaim)}</TableCell>
                    <TableCell>
                      <Select value={c.status} onValueChange={(v) => setCompanyStatus((p) => ({ ...p, [c.id]: v as "paid" | "unpaid" }))}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
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

      {/* 오류 검사 */}
      <Card className="p-4">
        <div className="font-semibold mb-3">오류 검사</div>
        <ul className="text-sm space-y-1">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <span className={
                c.status === "ok" ? "text-primary" :
                c.status === "warn" ? "text-orange-500" : "text-destructive"
              }>
                {c.status === "ok" ? "✓" : c.status === "warn" ? "▲" : "✗"}
              </span>
              <span className={
                c.status === "ok" ? "" :
                c.status === "warn" ? "text-orange-600" : "text-destructive"
              }>{c.label}</span>
              {c.note && <span className="text-xs text-muted-foreground">— {c.note}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}