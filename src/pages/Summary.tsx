import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt } from "@/lib/format";
import { allocateRow } from "@/lib/splitAllocation";

type Delivery = any;
type Company = { id: string; name: string; active: boolean };
type Leader = { id: string; name: string; active: boolean; is_rejected: boolean; is_virtual: boolean; settle_to_id: string | null };

export default function Summary() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Delivery[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);

  useEffect(() => {
    (async () => {
      const start = month + "-01";
      const next = new Date(start); next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const [{ data: d }, { data: c }, { data: l }] = await Promise.all([
        supabase.from("deliveries").select("*").gte("date", start).lt("date", end),
        supabase.from("companies").select("id,name,active").order("name"),
        supabase.from("team_leaders").select("id,name,active,is_rejected,is_virtual,settle_to_id").order("name"),
      ]);
      setRows(d || []);
      setCompanies((c as Company[]) || []);
      setLeaders((l as Leader[]) || []);
    })();
  }, [month]);

  const total = rows.reduce((s, r) => s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee), 0);
  const cod = rows.reduce((s, r) => s + Number(r.cod_amount), 0);
  const paid = rows.filter((r) => r.paid).length;

  // 업체 표시: 활성 업체만, 0건도 포함
  const companyRows = useMemo(() => {
    const visible = companies.filter((c) => c.active);
    return visible.map((c) => {
      const list = rows.filter((r) => r.company_id === c.id || r.company_name === c.name);
      const sumFee = list.reduce((s, r) => s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee), 0);
      const sumCod = list.reduce((s, r) => s + Number(r.cod_amount), 0);
      const paidCnt = list.filter((r) => r.paid).length;
      return { id: c.id, name: c.name, count: list.length, fee: sumFee, cod: sumCod, paid: paidCnt };
    });
  }, [companies, rows]);

  // 팀장 표시: 활성·비거부만. settle_to_id가 지정된 경우 실제 팀장에 합산.
  const leaderRows = useMemo(() => {
    const byId = new Map(leaders.map((l) => [l.id, l]));
    const shindongseokId = leaders.find((l) => l.name.trim() === "신동석")?.id || null;
    const ganghyungjuId = leaders.find((l) => l.name.trim() === "강형주")?.id || null;
    // 정착지 매핑: settle_to_id 체인을 따라 최종 팀장으로 (순환 방어)
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

    // 표시 대상: 활성·비거부, settle_to_id 없는 팀장만 (귀속된 팀장은 본 팀장에 합산)
    const visible = leaders.filter((l) => l.active && !l.is_rejected && !l.settle_to_id);
    const acc = new Map(visible.map((l) => [l.id, { id: l.id, name: l.name, count: 0, fee: 0, cod: 0 }]));

    for (const r of rows) {
      const shares = allocateRow({
        leader1_id: r.leader1_id, leader2_id: r.leader2_id, leader3_id: r.leader3_id,
        split_type: r.split_type, two_person: r.two_person,
        metro_fee: Number(r.metro_fee), note_amount: Number(r.note_amount),
        regional_fee: Number(r.regional_fee), cod_amount: Number(r.cod_amount),
      }, { shindongseokId, ganghyungjuId });
      const counted = new Set<string>();
      for (const s of shares) {
        const targetId = resolveSettleId(s.leader_id);
        const bucket = acc.get(targetId);
        if (!bucket) continue; // 거부/비활성/매핑 실패 팀장은 제외
        if (!counted.has(targetId)) { bucket.count += 1; counted.add(targetId); }
        bucket.fee += s.metro + s.note_amount + s.regional;
        bucket.cod += s.cod;
      }
    }
    return Array.from(acc.values()).sort((a, b) => b.fee - a.fee);
  }, [leaders, rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold flex-1">한눈요약</h1>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-xs text-muted-foreground">총 건수</div><div className="text-2xl font-bold">{rows.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">배송비 합계</div><div className="text-2xl font-bold">{fmt(total)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">착불 합계</div><div className="text-2xl font-bold">{fmt(cod)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">결제완료</div><div className="text-2xl font-bold">{paid}/{rows.length}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="overflow-x-auto">
          <div className="px-4 py-3 border-b font-semibold">업체별 요약 <span className="text-xs text-muted-foreground">(활성 업체만)</span></div>
          <Table className="text-sm num">
            <TableHeader>
              <TableRow>
                <TableHead>업체</TableHead>
                <TableHead className="text-right">건수</TableHead>
                <TableHead className="text-right">배송비</TableHead>
                <TableHead className="text-right">착불</TableHead>
                <TableHead className="text-right">결제</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companyRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{r.name}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{fmt(r.fee)}</TableCell>
                  <TableCell className="text-right">{fmt(r.cod)}</TableCell>
                  <TableCell className="text-right">{r.paid}/{r.count}</TableCell>
                </TableRow>
              ))}
              {companyRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">등록된 활성 업체가 없습니다.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>

        <Card className="overflow-x-auto">
          <div className="px-4 py-3 border-b font-semibold">팀장별 요약 <span className="text-xs text-muted-foreground">(활성·비거부, 정산귀속은 본 팀장에 합산)</span></div>
          <Table className="text-sm num">
            <TableHeader>
              <TableRow>
                <TableHead>팀장</TableHead>
                <TableHead className="text-right">건수</TableHead>
                <TableHead className="text-right">배송비</TableHead>
                <TableHead className="text-right">착불</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{r.name}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{fmt(r.fee)}</TableCell>
                  <TableCell className="text-right">{fmt(r.cod)}</TableCell>
                </TableRow>
              ))}
              {leaderRows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">표시할 팀장이 없습니다.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}