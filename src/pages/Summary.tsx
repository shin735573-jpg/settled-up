import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmt } from "@/lib/format";

export default function Summary() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const start = month + "-01";
      const next = new Date(start); next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const { data } = await supabase.from("deliveries").select("*").gte("date", start).lt("date", end);
      setRows(data || []);
    })();
  }, [month]);

  const total = rows.reduce((s, r) => s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee), 0);
  const cod = rows.reduce((s, r) => s + Number(r.cod_amount), 0);
  const paid = rows.filter((r) => r.paid).length;

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
      <Card className="p-6 text-sm text-muted-foreground">상세 요약 표는 다음 단계에서 추가합니다.</Card>
    </div>
  );
}