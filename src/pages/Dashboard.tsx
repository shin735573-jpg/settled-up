import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { fmt } from "@/lib/format";

export default function Dashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState({ count: 0, total: 0, companies: 0, leaders: 0 });

  useEffect(() => {
    (async () => {
      const start = month + "-01";
      const next = new Date(month + "-01"); next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const { data } = await supabase.from("deliveries").select("metro_fee,note_amount,regional_fee,company_id,leader1_id").gte("date", start).lt("date", end);
      const rows = data || [];
      const total = rows.reduce((s, r) => s + Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee), 0);
      setStats({
        count: rows.length,
        total,
        companies: new Set(rows.map((r) => r.company_id).filter(Boolean)).size,
        leaders: new Set(rows.map((r) => r.leader1_id).filter(Boolean)).size,
      });
    })();
  }, [month]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold flex-1 min-w-full sm:min-w-0 whitespace-nowrap">대시보드</h1>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-3 py-2" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-sm text-muted-foreground">총 건수</div><div className="text-2xl font-bold num">{stats.count}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">총 배송비</div><div className="text-2xl font-bold num">{fmt(stats.total)}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">업체 수</div><div className="text-2xl font-bold num">{stats.companies}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">팀장 수</div><div className="text-2xl font-bold num">{stats.leaders}</div></Card>
      </div>
      <Card className="p-6">
        <h2 className="font-semibold mb-2">시작하기</h2>
        <ol className="list-decimal list-inside text-sm space-y-1 text-muted-foreground">
          <li>설정에서 업체, 팀장, 휴무일을 등록합니다</li>
          <li>기록입력에서 엑셀 붙여넣기로 배송 기록을 한번에 추가합니다</li>
          <li>업체정산 / 팀장정산 메뉴에서 월별 정산 결과를 확인합니다</li>
        </ol>
      </Card>
    </div>
  );
}