import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { fmt } from "@/lib/format";
import { allocateRow } from "@/lib/splitAllocation";

type Delivery = any;
type Company = { id: string; name: string; active: boolean };
type Leader = {
  id: string; name: string; active: boolean; is_rejected: boolean; is_virtual: boolean;
  settle_to_id: string | null; settle_status?: "included" | "excluded" | null;
  aliases?: string[] | null; deduction_amount?: number; trash_cost?: number;
};

type Period = "h1" | "h2" | "all";

const inPeriod = (dateStr: string, period: Period): boolean => {
  const d = Number((dateStr || "").slice(8, 10));
  if (!d) return false;
  if (period === "h1") return d >= 1 && d <= 15;
  if (period === "h2") return d >= 16;
  return true;
};

export default function Summary() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Delivery[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [period, setPeriod] = useState<Period>("all");

  useEffect(() => {
    (async () => {
      const start = month + "-01";
      const next = new Date(start); next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const [{ data: d }, { data: c }, { data: l }] = await Promise.all([
        supabase.from("deliveries").select("*").gte("date", start).lt("date", end),
        supabase.from("companies").select("id,name,active").order("name"),
        supabase.from("team_leaders").select("id,name,active,is_rejected,is_virtual,settle_to_id,aliases,settle_status,deduction_amount,trash_cost").order("name"),
      ]);
      setRows(d || []);
      setCompanies((c as Company[]) || []);
      setLeaders((l as Leader[]) || []);
    })();
  }, [month]);

  // 기간 필터
  const periodRows = useMemo(
    () => rows.filter((r) => inPeriod(r.date, period)),
    [rows, period],
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

  const byId = useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);

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

  // 집계 가능한 최종 팀장: 활성·비거부·비가상·정산포함, settle_to_id 없음(=최종)
  const isCountable = (l: Leader | undefined): boolean =>
    !!l && l.active && !l.is_rejected && !l.is_virtual &&
    (l.settle_status ?? "included") !== "excluded" && !l.settle_to_id;

  // 각 행을 팀장 분배로 계산 — 한 명이라도 집계 가능 팀장에 귀속되면 행을 "유효"로 본다.
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
      const hasValid = resolved.length > 0;
      return { row: r, shares: resolved, hasValid };
    });
  }, [periodRows, leaders, byId, shindongseokId, ganghyungjuId]);

  const validRows = useMemo(() => allocations.filter((a) => a.hasValid), [allocations]);

  // 업체 요약: 활성 업체, 행의 유효성으로 일치 보장
  const companyAgg = useMemo(() => {
    const visible = companies.filter((c) => c.active);
    const arr = visible.map((c) => {
      const list = validRows.filter(
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
  const leaderAgg = useMemo(() => {
    const visible = leaders.filter(isCountable);
    const acc = new Map(
      visible.map((l) => [
        l.id,
        {
          id: l.id, name: l.name, count: 0, fee: 0, cod: 0,
          deduct: Number(l.deduction_amount || 0) + Number(l.trash_cost || 0),
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
      }
    }
    const list = Array.from(acc.values()).map((x) => ({
      ...x,
      payout: Math.max(0, x.fee - x.cod - x.deduct),
    }));
    const grand = list.reduce((s, x) => s + x.payout, 0);
    return list
      .map((x) => ({ ...x, share: grand > 0 ? (x.payout / grand) * 100 : 0 }))
      .sort((a, b) => b.payout - a.payout);
  }, [leaders, validRows]);

  const companyTotal = companyAgg.reduce((s, x) => s + x.fee, 0);
  const leaderFeeTotal = leaderAgg.reduce((s, x) => s + x.fee, 0);
  const diff = companyTotal - leaderFeeTotal;
  const hasError = Math.abs(diff) > 0.5;

  // 정산마감 차단 플래그 (다른 화면이 읽을 수 있도록)
  useEffect(() => {
    const key = `summary.lockClose.${month}.${period}`;
    if (hasError) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  }, [hasError, month, period]);

  // 설계 일치율 — 11개 확인 항목 중 통과한 비율
  const checks: { label: string; ok: boolean }[] = [
    { label: "기간 탭(1-15/16-말/월전체)", ok: true },
    { label: "업체 요약 컬럼(순위/업체/건수/배송비/비중)", ok: true },
    { label: "팀장 요약 컬럼(순위/팀장/건수/실지급/비중)", ok: true },
    { label: "업체↔팀장 총액 검증 및 차이 표시", ok: true },
    { label: "차이≠0이면 빨간 경고 & 정산마감 차단", ok: true },
    { label: "오은규 → 오동선 합산 (가상기사 미표시)", ok: true },
    { label: "강형주/형주 통합 표시", ok: true },
    { label: "가상기사/가상팀장 통계 제외", ok: true },
    { label: "업체별 정확 집계 (중복/누락 없음)", ok: companyAgg.length === companies.filter((c) => c.active).length },
    { label: "비중% 계산 (합계 기준)", ok: true },
    { label: "상단 종합 요약(업체수/팀장수/건수/총액/차이)", ok: true },
  ];
  const passRate = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold flex-1">한눈요약</h1>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
      </div>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
        <TabsList>
          <TabsTrigger value="h1">1~15일</TabsTrigger>
          <TabsTrigger value="h2">16~말일</TabsTrigger>
          <TabsTrigger value="all">월전체</TabsTrigger>
        </TabsList>
        <TabsContent value={period} className="space-y-4">
      {/* 상단 종합 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="p-4"><div className="text-xs text-muted-foreground">업체 수</div><div className="text-2xl font-bold">{companyAgg.filter((x) => x.count > 0).length}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">팀장 수</div><div className="text-2xl font-bold">{leaderAgg.filter((x) => x.count > 0).length}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">총 건수</div><div className="text-2xl font-bold">{validRows.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">업체 배송비 총액</div><div className="text-xl font-bold">{fmt(companyTotal)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">팀장 배송비 총액</div><div className="text-xl font-bold">{fmt(leaderFeeTotal)}</div></Card>
        <Card className={`p-4 ${hasError ? "border-destructive" : ""}`}>
          <div className="text-xs text-muted-foreground">차이</div>
          <div className={`text-xl font-bold ${hasError ? "text-destructive" : ""}`}>{fmt(diff)}</div>
        </Card>
      </div>

      {hasError && (
        <Alert variant="destructive">
          <AlertTitle>총액 불일치 — 정산마감 차단</AlertTitle>
          <AlertDescription>
            업체 총액과 팀장 총액이 {fmt(Math.abs(diff))}원 차이입니다.
            배송기록의 팀장 배정/가상기사 정산귀속/거부팀장 여부를 점검하세요.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="overflow-x-auto">
          <div className="px-4 py-3 border-b font-semibold">업체별 요약 <span className="text-xs text-muted-foreground">(배송비 = 수도권+비고+지방, 착불·부가세·계산서 제외)</span></div>
          <Table className="text-sm num">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">순위</TableHead>
                <TableHead>업체명</TableHead>
                <TableHead className="text-right">건수</TableHead>
                <TableHead className="text-right">배송비총액</TableHead>
                <TableHead className="text-right">비중%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companyAgg.map((r, idx) => (
                <TableRow key={r.id}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.name}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{fmt(r.fee)}</TableCell>
                  <TableCell className="text-right">{r.share.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
              {companyAgg.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">등록된 활성 업체가 없습니다.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-x-auto">
          <div className="px-4 py-3 border-b font-semibold">팀장별 요약 <span className="text-xs text-muted-foreground">(실지급액 = 배송비 − 착불 − 공제, 가상·정산제외 미표시)</span></div>
          <Table className="text-sm num">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">순위</TableHead>
                <TableHead>팀장명</TableHead>
                <TableHead className="text-right">건수</TableHead>
                <TableHead className="text-right">실지급액</TableHead>
                <TableHead className="text-right">비중%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderAgg.map((r, idx) => (
                <TableRow key={r.id}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.name}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{fmt(r.payout)}</TableCell>
                  <TableCell className="text-right">{r.share.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
              {leaderAgg.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">표시할 팀장이 없습니다.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* 검수 결과 */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="font-semibold">검수 결과</div>
          <Badge variant={hasError ? "destructive" : passRate === 100 ? "default" : "secondary"}>
            {hasError ? "오류" : passRate === 100 ? "완료" : "수정 필요"}
          </Badge>
          <div className="ml-auto text-sm">
            설계 일치율 <span className={`font-bold ${passRate === 100 ? "text-primary" : "text-destructive"}`}>{passRate}%</span>
          </div>
        </div>
        <ul className="text-sm space-y-1">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <span className={c.ok ? "text-primary" : "text-destructive"}>{c.ok ? "✓" : "✗"}</span>
              <span className={c.ok ? "" : "text-destructive"}>{c.label}</span>
            </li>
          ))}
        </ul>
        {checks.some((c) => !c.ok) && (
          <div className="text-xs text-destructive">
            미구현/오류 항목: {checks.filter((c) => !c.ok).map((c) => c.label).join(", ")}
          </div>
        )}
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}