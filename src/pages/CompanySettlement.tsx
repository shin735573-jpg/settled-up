import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { fmt } from "@/lib/format";
import { matchesCompany } from "@/lib/companyMatch";

type Period = "all" | "first" | "second" | "month";

export default function CompanySettlement() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [period, setPeriod] = useState<Period>("month");
  const [companies, setCompanies] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [allRows, setAllRows] = useState<any[]>([]);
  const [carryRows, setCarryRows] = useState<any[]>([]);
  const [leaders, setLeaders] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: l }] = await Promise.all([
        supabase.from("companies").select("*").eq("active", true).order("name"),
        supabase.from("team_leaders").select("id,name,is_rejected,is_virtual,settle_to_id"),
      ]);
      setCompanies(c || []);
      setLeaders(l || []);
    })();
  }, []);

  // 기간 범위 계산
  const range = useMemo(() => {
    if (period === "all") return { start: null as string | null, end: null as string | null };
    const start = month + "-01";
    const next = new Date(month + "-01"); next.setMonth(next.getMonth() + 1);
    const lastDay = new Date(next.getTime() - 86400000).getDate();
    if (period === "first") return { start, end: `${month}-16` }; // 1~15 (exclusive end = 16)
    if (period === "second") {
      const endNext = next.toISOString().slice(0, 10);
      return { start: `${month}-16`, end: endNext };
    }
    return { start, end: next.toISOString().slice(0, 10) };
  }, [month, period]);

  // 기간 내 전체 데이터 로드
  useEffect(() => {
    (async () => {
      let q = supabase.from("deliveries").select("*").order("date");
      if (range.start) q = q.gte("date", range.start);
      if (range.end) q = q.lt("date", range.end);
      const { data } = await q;
      setAllRows(data || []);
    })();
  }, [range.start, range.end]);

  // 이월착불금 = 기간 시작 이전의 미결제 착불 합계
  useEffect(() => {
    if (!range.start) { setCarryRows([]); return; }
    (async () => {
      const { data } = await supabase
        .from("deliveries")
        .select("company_id,company_name,cod_amount,paid,date")
        .lt("date", range.start!)
        .eq("paid", false);
      setCarryRows(data || []);
    })();
  }, [range.start]);

  const company = companies.find((c) => c.id === companyId);

  // 거부 팀장 → 그 팀장을 settle_to로 가진 가상기사 이름으로 대체.
  const displayLeaderName = (id: string | null, fallbackName: string | null): string => {
    if (!id) return fallbackName || "-";
    const real = leaders.find((l) => l.id === id);
    if (!real) return fallbackName || "-";
    if (!real.is_rejected) return real.name;
    const proxy = leaders.find((l) => l.is_virtual && l.settle_to_id === real.id);
    return proxy?.name || "가상기사";
  };

  // 업체별 요약 계산
  const summarize = (companyRows: any[], carryForCompany: any[]) => {
    let total = 0, paid = 0, unpaid = 0, cod = 0;
    companyRows.forEach((r) => {
      const delivery = Number(r.metro_fee) + Number(r.regional_fee) + Number(r.note_amount);
      total += delivery;
      if (r.paid) paid += delivery; else unpaid += delivery;
      cod += Number(r.cod_amount);
    });
    const carry = carryForCompany.reduce((s, r) => s + Number(r.cod_amount), 0);
    const net = unpaid + carry;
    return { count: companyRows.length, total, paid, unpaid, cod, carry, net };
  };

  const companySummaries = useMemo(() => {
    return companies.map((c) => {
      const rs = allRows.filter((r) => matchesCompany(r, c));
      const cr = carryRows.filter((r) => matchesCompany(r, c));
      return { company: c, ...summarize(rs, cr) };
    });
  }, [companies, allRows, carryRows]);

  const detailRows = useMemo(
    () => (company ? allRows.filter((r) => matchesCompany(r, company)) : []),
    [company, allRows]
  );
  const detailSummary = useMemo(() => {
    if (!company) return null;
    const cr = carryRows.filter((r) => matchesCompany(r, company));
    return summarize(detailRows, cr);
  }, [company, detailRows, carryRows]);

  const periodLabel =
    period === "all" ? "전체 기간" :
    period === "first" ? `${month} 1~15일` :
    period === "second" ? `${month} 16~말일` :
    `${month} 월전체`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {companyId && (
          <Button variant="outline" size="sm" onClick={() => setCompanyId("")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 전체 업체 목록
          </Button>
        )}
        <h1 className="text-2xl font-bold flex-1">업체정산</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          disabled={period === "all"}
          className="border rounded px-3 py-2"
        />
        <div className="flex gap-1">
          {([
            ["all", "전체"],
            ["first", "1~15일"],
            ["second", "16~말일"],
            ["month", "월전체"],
          ] as [Period, string][]).map(([p, label]) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "outline"}
              onClick={() => setPeriod(p)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {!companyId && (
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-2">{periodLabel} 기준 · 업체명 클릭 시 상세보기</div>
          <Table className="text-sm num">
            <TableHeader>
              <TableRow>
                <TableHead>업체명</TableHead>
                <TableHead className="text-right">건수</TableHead>
                <TableHead className="text-right">배송비합계</TableHead>
                <TableHead className="text-right">결제완료</TableHead>
                <TableHead className="text-right">미결제</TableHead>
                <TableHead className="text-right">착불합계</TableHead>
                <TableHead className="text-right">이월착불금</TableHead>
                <TableHead className="text-right">실청구액</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companySummaries.map((s) => (
                <TableRow key={s.company.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setCompanyId(s.company.id)}>
                  <TableCell>
                    <button className="text-primary hover:underline font-medium">{s.company.name}</button>
                  </TableCell>
                  <TableCell className="text-right">{s.count || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(s.total)}</TableCell>
                  <TableCell className="text-right">{fmt(s.paid)}</TableCell>
                  <TableCell className="text-right">{fmt(s.unpaid)}</TableCell>
                  <TableCell className="text-right">{fmt(s.cod)}</TableCell>
                  <TableCell className="text-right">{fmt(s.carry)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(s.net)}</TableCell>
                </TableRow>
              ))}
              {companySummaries.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">업체 없음</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {company && detailSummary && (
        <Card className="p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <h2 className="font-bold text-lg">{company.name}</h2>
            <span className="text-sm text-muted-foreground">{periodLabel}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4 num">
            <Stat label="배송비합계" value={detailSummary.total} />
            <Stat label="결제완료금액" value={detailSummary.paid} />
            <Stat label="미결제금액" value={detailSummary.unpaid} />
            <Stat label="착불합계" value={detailSummary.cod} />
            <Stat label="이월착불금" value={detailSummary.carry} />
            <Stat label="실청구액" value={detailSummary.net} highlight />
            {company.issues_invoice && (
              <Stat label="부가세포함 청구금액" value={detailSummary.net + Math.round(detailSummary.net * 0.1)} />
            )}
          </div>
          {company.issues_invoice && (
            <div className="text-xs text-muted-foreground mb-3">
              계산서 발행 업체 · 부가세 (10%) {fmt(Math.round(detailSummary.net * 0.1))}
            </div>
          )}
          <Table className="text-xs num">
            <TableHeader>
              <TableRow>
                <TableHead>날짜</TableHead>
                <TableHead>업체</TableHead>
                <TableHead>팀장1</TableHead>
                <TableHead>팀장2</TableHead>
                <TableHead>고객명</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>비고</TableHead>
                <TableHead className="text-right">배송비</TableHead>
                <TableHead>결제유무</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detailRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.date}</TableCell>
                  <TableCell>{r.company_name}</TableCell>
                  <TableCell>{displayLeaderName(r.leader1_id, r.leader1_name)}</TableCell>
                  <TableCell>{displayLeaderName(r.leader2_id, r.leader2_name)}</TableCell>
                  <TableCell>{r.customer_name || "-"}</TableCell>
                  <TableCell className="align-top min-w-[160px] max-w-[320px] whitespace-pre-wrap break-words">{r.item || "-"}</TableCell>
                  <TableCell className="align-top max-w-[240px] whitespace-pre-wrap break-words">{r.note || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee))}</TableCell>
                  <TableCell>{r.paid ? "결제완료" : "미결제"}</TableCell>
                </TableRow>
              ))}
              {detailRows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">데이터 없음</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-4">
            <Button variant="outline" onClick={() => setCompanyId("")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> 전체 업체 목록으로 돌아가기
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-3 rounded border ${highlight ? "bg-primary/10 border-primary" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{fmt(value)}</div>
    </div>
  );
}