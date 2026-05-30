import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmt } from "@/lib/format";
import { getDisplayName } from "@/lib/leaderResolver";

export default function LeaderSettlement() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [leaders, setLeaders] = useState<any[]>([]);
  const [leaderId, setLeaderId] = useState<string>("");
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("team_leaders").select("*").order("name");
      setLeaders(data || []);
      const selectable = (data || []).filter((l: any) => !l.is_virtual);
      if (!leaderId && selectable.length) setLeaderId(selectable[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!leaderId) return;
    (async () => {
      const start = month + "-01";
      const next = new Date(month + "-01"); next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const { data } = await supabase.from("deliveries").select("*").gte("date", start).lt("date", end).order("date");
      const targets = new Set<string>([leaderId]);
      leaders.forEach((l) => { if (l.settle_to_id === leaderId) targets.add(l.id); });
      const filtered = (data || []).filter((r) =>
        targets.has(r.leader1_id) || targets.has(r.leader2_id) || targets.has(r.leader3_id)
      );
      setRows(filtered);
    })();
  }, [month, leaderId, leaders]);

  const leader = leaders.find((l) => l.id === leaderId);
  const leaderById = useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);
  // 본인에게 정산귀속되는 다른 팀장들 (= 오은규 → 오동선)
  const mergedFrom = useMemo(
    () => leaders.filter((l) => l.settle_to_id === leaderId),
    [leaders, leaderId],
  );
  const mergedIds = useMemo(() => new Set(mergedFrom.map((l) => l.id)), [mergedFrom]);

  // 각 행의 합산 출처 팀장 (없으면 null = 본인 건)
  const mergedSourceForRow = (r: any) => {
    const ids = [r.leader1_id, r.leader2_id, r.leader3_id].filter(Boolean);
    const src = ids.find((id) => mergedIds.has(id));
    return src ? leaderById.get(src) : null;
  };

  const calc = useMemo(() => {
    let total = 0;
    let mergedTotal = 0;
    let mergedCount = 0;
    rows.forEach((r) => {
      const amt = Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
      total += amt;
      if (mergedSourceForRow(r)) { mergedTotal += amt; mergedCount += 1; }
    });
    const deduction = Number(leader?.deduction_amount || 0);
    const trash = Number(leader?.trash_cost || 0);
    return { total, deduction, trash, net: total - deduction - trash, mergedTotal, mergedCount };
  }, [rows, leader, mergedIds]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold flex-1">팀장정산</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-3 py-2" />
        <Select value={leaderId} onValueChange={setLeaderId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="팀장 선택" /></SelectTrigger>
          <SelectContent>
            {leaders.filter((l) => !l.is_virtual).map((l) => (
              <SelectItem key={l.id} value={l.id}>{getDisplayName(l, leaders)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {leader && (
        <Card className="p-4">
          <h2 className="font-bold text-lg mb-3">{getDisplayName(leader, leaders)} 정산서 ({month})</h2>
          {mergedFrom.length > 0 && (
            <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
              <div className="font-semibold text-amber-800">
                {mergedFrom.map((l) => l.name).join(", ")} 정산합산 포함
              </div>
              <div className="text-amber-700 num">
                합산 건수: <b>{calc.mergedCount}건</b> &nbsp;|&nbsp;
                합산 금액: <b>{fmt(calc.mergedTotal)}</b>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 num">
            <Stat label="배송비 총액" value={calc.total} />
            <Stat label="공제금" value={calc.deduction} />
            <Stat label="쓰레기비" value={calc.trash} />
            <Stat label="정산액" value={calc.net} highlight />
          </div>
          <Table className="text-xs num">
            <TableHeader>
              <TableRow>
                <TableHead>날짜</TableHead><TableHead>업체</TableHead><TableHead>고객</TableHead><TableHead>배송지</TableHead><TableHead>정산처리</TableHead>
                <TableHead className="text-right">배송비</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const src = mergedSourceForRow(r);
                return (
                <TableRow key={r.id} className={src ? "bg-amber-50 hover:bg-amber-100" : ""}>
                  <TableCell>{r.date}</TableCell>
                  <TableCell>{r.company_name}</TableCell>
                  <TableCell>{r.customer_name || "-"}</TableCell>
                  <TableCell>{r.region || "-"}</TableCell>
                  <TableCell className={src ? "text-amber-800 font-medium" : "text-muted-foreground"}>
                    {src ? `${src.name} → ${leader.name}` : "본인"}
                  </TableCell>
                  <TableCell className="text-right">{fmt(Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee))}</TableCell>
                </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">데이터 없음</TableCell></TableRow>}
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