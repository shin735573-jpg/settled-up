import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X, Search, Building2, Users, Maximize2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

type Company = { id: string; name: string; active: boolean };
type Leader = { id: string; name: string; active: boolean };
type Delivery = any;

type Sel =
  | { kind: "company"; id: string; name: string }
  | { kind: "leader"; id: string; name: string };

const SLOT_COUNT = 6;

type RangeMode = "month" | "day" | "range";

const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const monthStart = (m: string) => m + "-01";
const monthEndExclusive = (m: string) => {
  const d = new Date(m + "-01");
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

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
  const [rangeMode, setRangeMode] = useState<RangeMode>("month");
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [filterDay, setFilterDay] = useState<string>(() => todayStr());
  const [rangeStart, setRangeStart] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10);
  });
  const [rangeEnd, setRangeEnd] = useState<string>(() => todayStr());
  const [dailyFilter, setDailyFilter] = useState<string>(""); // 패널 내부 추가 일자 필터 (YYYY-MM-DD)
  const [slots, setSlots] = useState<(Sel | null)[]>(() => Array(SLOT_COUNT).fill(null));
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Sel | null>(null);

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
      let start = "", end = "";
      if (rangeMode === "month") {
        start = monthStart(filterMonth);
        end = monthEndExclusive(filterMonth);
      } else if (rangeMode === "day") {
        start = filterDay;
        end = addDays(filterDay, 1);
      } else {
        const s = rangeStart, e = rangeEnd;
        const lo = s <= e ? s : e;
        const hi = s <= e ? e : s;
        start = lo;
        end = addDays(hi, 1);
      }
      const { data } = await supabase
        .from("deliveries")
        .select("*")
        .gte("date", start)
        .lt("date", end)
        .order("date", { ascending: false })
        .limit(5000);
      setRecords(data || []);
      setDailyFilter("");
      setLoading(false);
    })();
  }, [rangeMode, filterMonth, filterDay, rangeStart, rangeEnd]);

  const setSlot = (idx: number, sel: Sel | null) =>
    setSlots((prev) => prev.map((s, i) => (i === idx ? sel : s)));
  const clearAll = () => setSlots(Array(SLOT_COUNT).fill(null));

  const recordsFor = (sel: Sel): Delivery[] => {
    let base = records;
    if (sel.kind === "company") {
      base = base.filter((r) => r.company_id === sel.id);
    } else {
      // 오은규 배송은 오동선으로 합산 정산되므로, 오동선 상세에 오은규 행도 포함해서 표시.
      const odongseonId = leaders.find((l) => l.name.trim() === "오동선")?.id ?? null;
      const oeunkyuId = leaders.find((l) => l.name.trim() === "오은규")?.id ?? null;
      const includeOeunkyu = !!odongseonId && !!oeunkyuId && sel.id === odongseonId;
      base = base.filter((r) => {
        const ids = [r.leader1_id, r.leader2_id, r.leader3_id];
        if (ids.includes(sel.id)) return true;
        if (includeOeunkyu && ids.includes(oeunkyuId)) return true;
        return false;
      });
    }
    if (dailyFilter) base = base.filter((r) => r.date === dailyFilter);
    return base;
  };

  // 현재 로드된 데이터 안에서 존재하는 날짜들 (drill-down용)
  const availableDates = useMemo(() => {
    const s = new Set<string>();
    for (const r of records) if (r.date) s.add(r.date);
    return Array.from(s).sort().reverse();
  }, [records]);

  const rangeLabel = useMemo(() => {
    if (rangeMode === "month") return `${filterMonth} (월)`;
    if (rangeMode === "day") return `${filterDay} (하루)`;
    return `${rangeStart} ~ ${rangeEnd}`;
  }, [rangeMode, filterMonth, filterDay, rangeStart, rangeEnd]);

  const filledCount = slots.filter(Boolean).length;
  const usedKeys = new Set(slots.filter(Boolean).map((s) => `${s!.kind}:${s!.id}`));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold flex-1 min-w-full sm:min-w-0">배송내역 조회</h1>
        <Badge variant="secondary">{records.length}건</Badge>
        {filledCount > 0 && (
          <Button variant="outline" size="sm" onClick={clearAll}>전체 비우기</Button>
        )}
      </div>

      <Card className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">조회 단위</Label>
            <div className="inline-flex rounded-md border overflow-hidden">
              {(["month", "range", "day"] as RangeMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRangeMode(m)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium",
                    rangeMode === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
                  )}
                >
                  {m === "month" ? "월별" : m === "range" ? "기간" : "하루"}
                </button>
              ))}
            </div>
          </div>

          {rangeMode === "month" && (
            <div className="space-y-1">
              <Label className="text-xs">월 선택</Label>
              <Input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="w-40 h-9" />
            </div>
          )}
          {rangeMode === "day" && (
            <div className="space-y-1">
              <Label className="text-xs">날짜</Label>
              <Input type="date" value={filterDay} onChange={(e) => setFilterDay(e.target.value)} className="w-44 h-9" />
            </div>
          )}
          {rangeMode === "range" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">시작일</Label>
                <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="w-44 h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">종료일</Label>
                <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className="w-44 h-9" />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { const t = todayStr(); setRangeStart(t); setRangeEnd(t); }}>오늘</Button>
                <Button size="sm" variant="outline" onClick={() => { setRangeStart(addDays(todayStr(), -6)); setRangeEnd(todayStr()); }}>최근 7일</Button>
                <Button size="sm" variant="outline" onClick={() => { setRangeStart(addDays(todayStr(), -29)); setRangeEnd(todayStr()); }}>최근 30일</Button>
              </div>
            </>
          )}

          <div className="flex-1" />
          <div className="text-xs text-muted-foreground">조회 범위: <span className="font-semibold">{rangeLabel}</span></div>
        </div>

        {rangeMode !== "day" && availableDates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-2 border-t">
            <span className="text-xs text-muted-foreground mr-1">하루별 보기:</span>
            <button
              type="button"
              onClick={() => setDailyFilter("")}
              className={cn(
                "text-xs px-2 py-1 rounded border",
                dailyFilter === "" ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent",
              )}
            >
              전체
            </button>
            {availableDates.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDailyFilter(d === dailyFilter ? "" : d)}
                className={cn(
                  "text-xs px-2 py-1 rounded border tabular-nums",
                  dailyFilter === d ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent",
                )}
              >
                {d.slice(5)}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-3 md:p-4">
        <div className="text-xs text-muted-foreground mb-2">
          1~6번 칸을 각각 업체 또는 팀장으로 지정해 동시에 비교하세요. 헤더 확대 아이콘으로 상세보기.
        </div>
        <div className={cn("grid gap-2", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
          {slots.map((sel, idx) => (
            <SlotPicker
              key={idx}
              index={idx}
              value={sel}
              companies={companies}
              leaders={leaders}
              usedKeys={usedKeys}
              onChange={(v) => setSlot(idx, v)}
            />
          ))}
        </div>
      </Card>

      {filledCount === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Search className="h-10 w-10 mx-auto mb-2 opacity-40" />
          위의 1~6번 칸에서 업체나 팀장을 선택하면 비교 패널이 여기에 나타납니다.
        </Card>
      ) : (
        <div className={cn("grid gap-3", gridColsByCount(filledCount))}>
          {slots.map((sel, idx) =>
            sel ? (
              <PanelCard
                key={`${idx}-${sel.kind}-${sel.id}`}
                index={idx}
                sel={sel}
                records={recordsFor(sel)}
                loading={loading}
                onClose={() => setSlot(idx, null)}
                onDetail={() => setDetail(sel)}
              />
            ) : null,
          )}
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {detail && (
                <span className="flex items-center gap-2">
                  {detail.kind === "company" ? <Building2 className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                  <span>{detail.name}</span>
                  <Badge variant="outline">{detail.kind === "company" ? "업체" : "팀장"}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{rangeLabel}{dailyFilter ? ` · ${dailyFilter}` : ""}</span>
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <DetailView sel={detail} records={recordsFor(detail)} loading={loading} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SlotPicker({
  index,
  value,
  companies,
  leaders,
  usedKeys,
  onChange,
}: {
  index: number;
  value: Sel | null;
  companies: Company[];
  leaders: Leader[];
  usedKeys: Set<string>;
  onChange: (v: Sel | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const nq = norm(q);
  const filteredCompanies = companies.filter((c) => !nq || norm(c.name).includes(nq)).slice(0, 30);
  const filteredLeaders = leaders.filter((l) => !nq || norm(l.name).includes(nq)).slice(0, 30);

  const pick = (sel: Sel) => {
    onChange(sel);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="border rounded-md p-2 bg-background relative">
      <div className="flex items-center gap-2 mb-1">
        <Badge className="h-5 px-1.5 text-[11px]">{index + 1}번</Badge>
        {value ? (
          <>
            {value.kind === "company" ? <Building2 className="h-3.5 w-3.5 text-primary" /> : <Users className="h-3.5 w-3.5 text-secondary-foreground" />}
            <span className="font-semibold truncate flex-1" title={value.name}>{value.name}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange(null)} aria-label="비우기">
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground flex-1">비어 있음</span>
        )}
      </div>
      <div className="relative">
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value ? "변경: 업체/팀장 검색" : "업체 또는 팀장 검색"}
          className="h-8 text-xs"
        />
        {open && (q || filteredCompanies.length + filteredLeaders.length > 0) && (
          <div className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg text-sm">
            {filteredCompanies.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide bg-muted text-muted-foreground sticky top-0">업체</div>
                {filteredCompanies.map((c) => {
                  const used = usedKeys.has(`company:${c.id}`);
                  return (
                    <div
                      key={c.id}
                      onMouseDown={(e) => { e.preventDefault(); if (!used) pick({ kind: "company", id: c.id, name: c.name }); }}
                      className={cn("px-2 py-1.5 cursor-pointer flex items-center gap-2", used ? "opacity-40 cursor-not-allowed" : "hover:bg-accent")}
                    >
                      <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate">{c.name}</span>
                      {used && <span className="ml-auto text-[10px] text-muted-foreground">사용중</span>}
                    </div>
                  );
                })}
              </>
            )}
            {filteredLeaders.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide bg-muted text-muted-foreground sticky top-0">팀장</div>
                {filteredLeaders.map((l) => {
                  const used = usedKeys.has(`leader:${l.id}`);
                  return (
                    <div
                      key={l.id}
                      onMouseDown={(e) => { e.preventDefault(); if (!used) pick({ kind: "leader", id: l.id, name: l.name }); }}
                      className={cn("px-2 py-1.5 cursor-pointer flex items-center gap-2", used ? "opacity-40 cursor-not-allowed" : "hover:bg-accent")}
                    >
                      <Users className="h-3.5 w-3.5 text-secondary-foreground shrink-0" />
                      <span className="truncate">{l.name}</span>
                      {used && <span className="ml-auto text-[10px] text-muted-foreground">사용중</span>}
                    </div>
                  );
                })}
              </>
            )}
            {filteredCompanies.length + filteredLeaders.length === 0 && (
              <div className="px-3 py-2 text-muted-foreground">결과 없음</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PanelCard({
  index,
  sel,
  records,
  loading,
  onClose,
  onDetail,
}: {
  index: number;
  sel: Sel;
  records: Delivery[];
  loading: boolean;
  onClose: () => void;
  onDetail: () => void;
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
        <Badge className="mr-2 h-5 px-1.5 text-[11px] shrink-0">{index + 1}</Badge>
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
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-1 shrink-0" onClick={onDetail} aria-label="상세보기">
          <Maximize2 className="h-4 w-4" />
        </Button>
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

function DetailView({ sel, records, loading }: { sel: Sel; records: Delivery[]; loading: boolean }) {
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <Stat label="건수" value={`${records.length}건`} />
        <Stat label="수도권" value={fmt(totals.metro)} />
        <Stat label="지방" value={fmt(totals.regional)} />
        <Stat label="기록란" value={fmt(totals.note)} />
        <Stat label="착불 합계" value={fmt(totals.cod)} highlight />
      </div>
      <div className="overflow-auto max-h-[60vh] border rounded-md">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr className="text-left">
              <th className="p-2 whitespace-nowrap">날짜</th>
              <th className="p-2 whitespace-nowrap">{sel.kind === "company" ? "팀장" : "업체"}</th>
              <th className="p-2 whitespace-nowrap">고객</th>
              <th className="p-2 whitespace-nowrap">배송지</th>
              <th className="p-2 whitespace-nowrap">품목</th>
              {sel.kind === "leader" ? (
                <th className="p-2 text-right whitespace-nowrap">배송비</th>
              ) : (
                <>
                  <th className="p-2 text-right whitespace-nowrap">수도권</th>
                  <th className="p-2 text-right whitespace-nowrap">지방</th>
                  <th className="p-2 text-right whitespace-nowrap">기록</th>
                </>
              )}
              <th className="p-2 text-right whitespace-nowrap">착불</th>
              {sel.kind !== "leader" && <th className="p-2 whitespace-nowrap">비고</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={sel.kind === "leader" ? 7 : 10} className="p-4 text-center text-muted-foreground">불러오는 중…</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={sel.kind === "leader" ? 7 : 10} className="p-4 text-center text-muted-foreground">해당 월 배송내역 없음</td></tr>
            ) : records.map((r) => {
              const leadersTxt = [r.leader1_name, r.leader2_name, r.leader3_name].filter(Boolean).join("·");
              const feeSum = Number(r.metro_fee || 0) + Number(r.regional_fee || 0) + Number(r.note_amount || 0);
              return (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 whitespace-nowrap">{r.date}</td>
                  <td className="p-2 whitespace-nowrap">{sel.kind === "company" ? (leadersTxt || "-") : (r.company_name || "-")}</td>
                  <td className="p-2 whitespace-nowrap">{r.customer_name || "-"}</td>
                  <td className="p-2 whitespace-nowrap max-w-[180px] truncate" title={r.region || ""}>{r.region || "-"}</td>
                  <td className="p-2 whitespace-nowrap max-w-[220px] truncate" title={r.item || ""}>{r.item || "-"}</td>
                  {sel.kind === "leader" ? (
                    <td className="p-2 text-right tabular-nums">{fmt(feeSum)}</td>
                  ) : (
                    <>
                      <td className="p-2 text-right tabular-nums">{fmt(Number(r.metro_fee || 0))}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(Number(r.regional_fee || 0))}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(Number(r.note_amount || 0))}</td>
                    </>
                  )}
                  <td className="p-2 text-right tabular-nums">{fmt(Number(r.cod_amount || 0))}</td>
                  {sel.kind !== "leader" && (
                    <td className="p-2 whitespace-nowrap max-w-[160px] truncate" title={r.note || ""}>{r.note || ""}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("border rounded-md p-2", highlight && "bg-primary/10 border-primary/40")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-bold tabular-nums">{value}</div>
    </div>
  );
}