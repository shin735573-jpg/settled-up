import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmt } from "@/lib/format";

export default function CompanySettlement() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [companies, setCompanies] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [rows, setRows] = useState<any[]>([]);
  const [leaders, setLeaders] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: l }] = await Promise.all([
        supabase.from("companies").select("*").eq("active", true).order("name"),
        supabase.from("team_leaders").select("id,name,is_rejected,is_virtual,settle_to_id"),
      ]);
      setCompanies(c || []);
      setLeaders(l || []);
      if (!companyId && c?.length) setCompanyId(c[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const start = month + "-01";
      const next = new Date(month + "-01"); next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const { data } = await supabase.from("deliveries").select("*").eq("company_id", companyId).gte("date", start).lt("date", end).order("date");
      setRows(data || []);
    })();
  }, [month, companyId]);

  const company = companies.find((c) => c.id === companyId);

  // 거부 팀장 → 그 팀장을 settle_to로 가진 가상기사 이름으로 대체.
  // 매핑 실패 시 "가상기사"로 표기. 거부 팀장 실명은 업체 정산서에 절대 노출하지 않음.
  const displayLeaderName = (id: string | null, fallbackName: string | null): string => {
    if (!id) return fallbackName || "-";
    const real = leaders.find((l) => l.id === id);
    if (!real) return fallbackName || "-";
    if (!real.is_rejected) return real.name;
    const proxy = leaders.find((l) => l.is_virtual && l.settle_to_id === real.id);
    return proxy?.name || "가상기사";
  };

  const calc = useMemo(() => {
    if (!company) return { total: 0, fee: 0, vat: 0, cod: 0, net: 0 };
    let total = 0, fee = 0, cod = 0;
    rows.forEach((r) => {
      const delivery = Number(r.metro_fee) + Number(r.regional_fee);
      total += delivery + Number(r.note_amount);
      const metroFee = Number(r.metro_fee) * Number(company.fee_rate_metro) / 100;
      const regionalFee = Number(r.regional_fee) * Number(company.fee_rate_regional) / 100;
      fee += metroFee + regionalFee;
      cod += Number(r.cod_amount);
    });
    const vat = company.issues_invoice ? Math.round(fee * 0.1) : 0;
    const net = total - fee - vat - cod;
    return { total, fee, vat, cod, net };
  }, [rows, company]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold flex-1">업체정산</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-3 py-2" />
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="업체 선택" /></SelectTrigger>
          <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {company && (
        <Card className="p-4">
          <h2 className="font-bold text-lg mb-3">{company.name} 정산서 ({month})</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 num">
            <Stat label="배송비 총액" value={calc.total} />
            <Stat label="수수료" value={calc.fee} />
            {company.issues_invoice && <Stat label="부가세 (10%)" value={calc.vat} />}
            <Stat label="착불" value={calc.cod} />
            <Stat label="정산액" value={calc.net} highlight />
          </div>
          <Table className="text-xs num">
            <TableHeader>
              <TableRow>
                <TableHead>날짜</TableHead><TableHead>기사</TableHead><TableHead>고객</TableHead><TableHead>지역</TableHead>
                <TableHead>품목</TableHead><TableHead className="text-right">배송비</TableHead><TableHead className="text-right">착불</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const names = [
                  displayLeaderName(r.leader1_id, r.leader1_name),
                  displayLeaderName(r.leader2_id, r.leader2_name),
                  displayLeaderName(r.leader3_id, r.leader3_name),
                ].filter((n) => n && n !== "-");
                return (
                <TableRow key={r.id}>
                  <TableCell>{r.date}</TableCell>
                  <TableCell className="whitespace-nowrap">{names.join(", ") || "-"}</TableCell>
                  <TableCell>{r.customer_name || "-"}</TableCell>
                  <TableCell>{r.region || "-"}</TableCell>
                  <TableCell className="align-top min-w-[160px] max-w-[320px] whitespace-pre-wrap break-words">{r.item || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee))}</TableCell>
                  <TableCell className="text-right">{fmt(r.cod_amount)}</TableCell>
                </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">데이터 없음</TableCell></TableRow>}
            </TableBody>
          </Table>
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