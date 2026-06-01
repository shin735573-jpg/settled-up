import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompanyCombobox } from "@/components/CompanyCombobox";
import { LeaderCombobox } from "@/components/LeaderCombobox";
import { X, Search } from "lucide-react";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

type Company = { id: string; name: string; active: boolean };
type Leader = { id: string; name: string; active: boolean };
type Delivery = any;

type Sel =
  | { kind: "company"; id: string; name: string }
  | { kind: "leader"; id: string; name: string };

const MAX_PANELS = 6;

const gridColsByCount = (n: number) => {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-1 lg:grid-cols-2";
  if (n === 3) return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
  if (n === 4) return "grid-cols-1 md:grid-cols-2";
  return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"; // 5,6
};

export default function RecordsBrowse() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [records, setRecords] = useState<Delivery[]>([]);
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [mode, setMode] = useState<"company" | "leader">("company");
  const [sels, setSels] = useState<Sel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: l }] = await Promise.all([
        supabase.from("companies").select("id,name,active").order("name"),
        supabase.from("team_leaders").select("id,name,active").order("name"),
      ]);
      setCompanies(((c as Company[]) || []).filter((x) => x.active));
      setLeaders(((l as Leader[]) || []).filter((x) => x.active));
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const start = filterMonth + "-01";
      const next = new Date(filterMonth + "-01");
      next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const { data } = await supabase
        .from("deliveries")
        .select("*")
        .gte("date", start)
        .lt("date", end)
        .order("date", { ascending: false })
        .limit(2000);
      setRecords(data || []);
      setLoading(false);
    })();
  }, [filterMonth]);

  const addSel = (sel: Sel) => {
    setSels((prev) => {
      if (prev.some((s) => s.kind === sel.kind && s.id === sel.id)) return prev;
      if (prev.length >= MAX_PANELS) return prev;
      return [...prev, sel];
    });
  };

  const removeSel = (idx: number) => setSels((prev) => prev.filter((_, i) => i !== idx));

  const recordsFor = (sel: Sel): Delivery[] => {
    if (sel.kind === "company") {
      return records.filter((r) => r.company_id === sel.id);
    }
    return records.filter(
      (r) => r.leader1_id === sel.id || r.leader2_id === sel.id || r.leader3_id === sel.id,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold flex-1 min-w-full sm:min-w-0">배송내역 조회</h1>
        <Input
          type="month"
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="w-40"
        />
        <Badge variant="secondary">{records.length}건</Badge>
      </div>

      <Card className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">검색 유형</Label>
            <Tabs value={mode} onValueChange={(v) => setMode(v as "company" | "leader")}>
              <TabsList>
                <TabsTrigger value="company">업체</TabsTrigger>
                <TabsTrigger value="leader">팀장</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="space-y-1 min-w-[260px] flex-1">
            <Label className="text-xs">
              {mode === "company" ? "업체 추가" : "팀장 추가"} (최대 {MAX_PANELS}건)
            </Label>
            {mode === "company" ? (
              <CompanyCombobox
                companies={companies.map((c) => ({ id: c.id, name: c.name }))}
                value=""
                onChange={(id) => {
                  const c = companies.find((x) => x.id === id);
                  if (c) addSel({ kind: "company", id: c.id, name: c.name });
                }}
                placeholder="업체명 입력 (↑↓ 선택)"
              />
            ) : (
              <LeaderCombobox
                leaders={leaders.map((l) => ({ id: l.id, name: l.name }))}
                value=""
                onChange={(id) => {
                  const l = leaders.find((x) => x.id === id);
                  if (l) addSel({ kind: "leader", id: l.id, name: l.name });
                }}
                placeholder="팀장명 입력 (↑↓ 선택)"
              />
            )}
          </div>
          {sels.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setSels([])}>
              전체 비우기
            </Button>
          )}
        </div>

        {sels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sels.map((s, i) => (
              <Badge
                key={`${s.kind}-${s.id}`}
                variant={s.kind === "company" ? "default" : "secondary"}
                className="gap-1 pr-1"
              >
                <span className="text-[10px] opacity-70">{s.kind === "company" ? "업체" : "팀장"}</span>
                <span>{s.name}</span>
                <button
                  type="button"
                  onClick={() => removeSel(i)}
                  className="ml-1 hover:bg-background/30 rounded p-0.5"
                  aria-label="제거"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {sels.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Search className="h-10 w-10 mx-auto mb-2 opacity-40" />
          위에서 업체나 팀장을 추가하면 해당 배송내역이 여기 분할 화면으로 표시됩니다 (최대 {MAX_PANELS}건 동시).
        </Card>
      ) : (
        <div className={cn("grid gap-3", gridColsByCount(sels.length))}>
          {sels.map((sel, idx) => (
            <PanelCard
              key={`${sel.kind}-${sel.id}-${idx}`}
              sel={sel}
              records={recordsFor(sel)}
              loading={loading}
              onClose={() => removeSel(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PanelCard({
  sel,
  records,
  loading,
  onClose,
}: {
  sel: Sel;
  records: Delivery[];
  loading: boolean;
  onClose: () => void;
}) {
  const totals = useMemo(() => {
    let metro = 0, note = 0, regional = 0, cod = 0;
    for (const r of records) {
      metro += Number(r.metro_fee || 0);
      note += Number(r.note_amount || 0);
      regional += Number(r.regional_fee || 0);
      cod += Number(r.cod_amount || 0);
    }
    return { metro, note, regional, cod, sum: metro + note + regional };
  }, [records]);

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className={cn(
        "px-3 py-2 border-b flex items-center justify-between",
        sel.kind === "company" ? "bg-primary/10" : "bg-secondary",
      )}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70">
            {sel.kind === "company" ? "업체" : "팀장"}
          </div>
          <div className="font-bold truncate">{sel.name}</div>
        </div>
        <div className="text-right text-xs shrink-0">
          <div className="font-semibold">{records.length}건</div>
          <div className="text-muted-foreground tabular-nums">{fmt(totals.sum)}</div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-1 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="overflow-auto max-h-[60vh]">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr className="text-left">
              <th className="p-2 whitespace-nowrap">날짜</th>
              {sel.kind === "leader" && <th className="p-2 whitespace-nowrap">업체</th>}
              {sel.kind === "company" && <th className="p-2 whitespace-nowrap">팀장</th>}
              <th className="p-2 whitespace-nowrap">고객</th>
              <th className="p-2 whitespace-nowrap">배송지</th>
              <th className="p-2 whitespace-nowrap">품목</th>
              <th className="p-2 text-right whitespace-nowrap">배송비</th>
              <th className="p-2 text-right whitespace-nowrap">착불</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">불러오는 중…</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">해당 월 배송내역 없음</td></tr>
            ) : records.map((r) => {
              const fee = Number(r.metro_fee || 0) + Number(r.note_amount || 0) + Number(r.regional_fee || 0);
              const leadersTxt = [r.leader1_name, r.leader2_name, r.leader3_name].filter(Boolean).join("·");
              return (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 whitespace-nowrap">{r.date}</td>
                  {sel.kind === "leader" && <td className="p-2 whitespace-nowrap">{r.company_name || "-"}</td>}
                  {sel.kind === "company" && <td className="p-2 whitespace-nowrap">{leadersTxt || "-"}</td>}
                  <td className="p-2 whitespace-nowrap">{r.customer_name || "-"}</td>
                  <td className="p-2 whitespace-nowrap max-w-[140px] truncate" title={r.region || ""}>{r.region || "-"}</td>
                  <td className="p-2 whitespace-nowrap max-w-[200px] truncate" title={r.item || ""}>{r.item || "-"}</td>
                  <td className="p-2 text-right tabular-nums">{fmt(fee)}</td>
                  <td className="p-2 text-right tabular-nums">{fmt(Number(r.cod_amount || 0))}</td>
                </tr>
              );
            })}
          </tbody>
          {records.length > 0 && (
            <tfoot className="bg-muted/60 font-semibold">
              <tr>
                <td className="p-2" colSpan={sel.kind === "company" || sel.kind === "leader" ? 5 : 5}>합계</td>
                <td className="p-2 text-right tabular-nums">{fmt(totals.sum)}</td>
                <td className="p-2 text-right tabular-nums">{fmt(totals.cod)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}