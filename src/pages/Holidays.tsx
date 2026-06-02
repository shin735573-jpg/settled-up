import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Trash2, CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getKoreanHolidayName } from "@/lib/koreanHolidays";
import { useSaveConfirm } from "@/components/SaveConfirmDialog";

type Leader = { id: string; name: string; active: boolean; is_virtual: boolean };
type Holiday = {
  id: string;
  date: string;
  scope: "hq" | "leader" | string;
  team_leader_id: string | null;
  reason: string | null;
  note: string | null;
  active: boolean;
};

const HQ_VALUE = "__hq__";

const toISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

export default function Holidays() {
  const { user } = useAuth();
  const { confirm: confirmSave, dialog: saveConfirmDialog } = useSaveConfirm();
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [rows, setRows] = useState<Holiday[]>([]);

  // 입력 폼
  const [target, setTarget] = useState<string>(HQ_VALUE);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [active, setActive] = useState(true);

  // 필터
  const [filter, setFilter] = useState<string>("all"); // all|hq|<leaderId>
  const [period, setPeriod] = useState<"all" | "this" | "next">("all");
  const [calMonth, setCalMonth] = useState<Date>(new Date());

  const load = async () => {
    const [{ data: l }, { data: h }] = await Promise.all([
      supabase
        .from("team_leaders")
        .select("id,name,active,is_virtual")
        .eq("active", true)
        .order("name"),
      supabase.from("holidays").select("*").order("date", { ascending: false }),
    ]);
    setLeaders((l as Leader[]) || []);
    setRows((h as Holiday[]) || []);
  };
  useEffect(() => { load(); }, []);

  // 휴무일관리 대상: 본사 + 실제 선택 가능한 모든 팀장(가상팀장 포함)
  // 본사는 항상 최상단
  const targets = useMemo(
    () => [{ id: HQ_VALUE, name: "본사" }, ...leaders.map((l) => ({ id: l.id, name: l.name }))],
    [leaders],
  );

  const leaderNameById = useMemo(() => {
    const m = new Map<string, string>();
    leaders.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [leaders]);

  const add = async () => {
    if (!user) return;
    if (!date) return toast.error("휴무 날짜를 선택하세요");
    const isHQ = target === HQ_VALUE;
    const targetName = isHQ ? "본사" : (leaderNameById.get(target) || "팀장");
    const summary = [
      { label: "대상", value: targetName },
      { label: "날짜", value: toISO(date) },
      ...(reason ? [{ label: "사유", value: reason }] : []),
      ...(note ? [{ label: "메모", value: note }] : []),
      { label: "상태", value: active ? "활성" : "비활성" },
    ];
    const ok = await confirmSave({ title: "휴무일 추가 확인", summary, confirmLabel: "추가" });
    if (!ok) return;
    const { error } = await supabase.from("holidays").insert({
      user_id: user.id,
      date: toISO(date),
      scope: isHQ ? "hq" : "leader",
      team_leader_id: isHQ ? null : target,
      reason: reason || null,
      note: note || null,
      active,
    });
    if (error) return toast.error(error.message);
    toast.success("휴무일이 추가되었습니다");
    setReason(""); setNote(""); setActive(true);
    load();
  };

  const del = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("holidays").delete().eq("id", id);
    load();
  };

  const toggleActive = async (r: Holiday) => {
    await supabase.from("holidays").update({ active: !r.active }).eq("id", r.id);
    load();
  };

  // 필터링
  const filteredRows = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
    return rows.filter((r) => {
      if (filter === "hq" && r.scope !== "hq") return false;
      if (filter !== "all" && filter !== "hq" && r.team_leader_id !== filter) return false;
      if (period === "this" && !r.date.startsWith(thisMonth)) return false;
      if (period === "next" && !r.date.startsWith(nextMonth)) return false;
      return true;
    });
  }, [rows, filter, period]);

  // 달력 보기용: 월별 휴무일 맵
  const calMonthKey = `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, "0")}`;
  const monthHolidays = useMemo(
    () => rows.filter((r) => r.active && r.date.startsWith(calMonthKey)),
    [rows, calMonthKey],
  );
  const hqDates = new Set(monthHolidays.filter((r) => r.scope === "hq").map((r) => r.date));
  const leaderDates = new Set(monthHolidays.filter((r) => r.scope === "leader").map((r) => r.date));

  const targetLabel = (r: Holiday) =>
    r.scope === "hq" ? "본사" : leaderNameById.get(r.team_leader_id || "") || "-";

  return (
    <div className="space-y-4">
      {saveConfirmDialog}
      <h1 className="text-2xl font-bold">휴무일관리</h1>

      {/* 입력 폼 */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
          <div>
            <label className="text-xs text-muted-foreground">대상</label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">휴무 날짜</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "yyyy-MM-dd") : "날짜 선택"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  locale={ko}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">휴무 사유</label>
            <Input placeholder="예: 명절" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">비고</label>
            <Input placeholder="비고" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} />
            <span className="text-sm">사용여부</span>
          </div>
          <Button onClick={add}>추가</Button>
        </div>
      </Card>

      {/* 보기 전환 탭 */}
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">목록 보기</TabsTrigger>
          <TabsTrigger value="calendar">달력 보기</TabsTrigger>
        </TabsList>

        {/* 목록 보기 */}
        <TabsContent value="list" className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="hq">본사</SelectItem>
                {leaders.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체기간</SelectItem>
                <SelectItem value="this">이번달</SelectItem>
                <SelectItem value="next">다음달</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground ml-auto">
              총 {filteredRows.length}건
            </span>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>대상</TableHead>
                  <TableHead>휴무 날짜</TableHead>
                  <TableHead>휴무 사유</TableHead>
                  <TableHead>비고</TableHead>
                  <TableHead>사용여부</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => (
                  <TableRow key={r.id} className={!r.active ? "opacity-50" : ""}>
                    <TableCell>
                      {r.scope === "hq" ? (
                        <Badge variant="destructive">본사</Badge>
                      ) : (
                        <Badge variant="secondary">{targetLabel(r)}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{r.date}</TableCell>
                    <TableCell>{r.reason || "-"}</TableCell>
                    <TableCell>{r.note || "-"}</TableCell>
                    <TableCell>
                      <Switch checked={r.active} onCheckedChange={() => toggleActive(r)} />
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => del(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      등록된 휴무일이 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* 달력 보기 */}
        <TabsContent value="calendar">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-lg font-semibold">{calMonthKey}</div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-3 mb-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-destructive inline-block" /> 본사휴무</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-400 inline-block" /> 팀장휴무</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" /> 공휴일</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-red-600 inline-block" /> 일요일</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border-2 border-primary inline-block" /> 오늘</span>
            </div>
            <CalendarMonth
              month={calMonth}
              hqDates={hqDates}
              leaderDates={leaderDates}
              holidays={monthHolidays}
              leaderNameById={leaderNameById}
            />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CalendarMonth({
  month, hqDates, leaderDates, holidays, leaderNameById,
}: {
  month: Date;
  hqDates: Set<string>;
  leaderDates: Set<string>;
  holidays: Holiday[];
  leaderNameById: Map<string, string>;
}) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = toISO(new Date());

  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7) cells.push(null);

  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

  const itemsByDate = new Map<string, Holiday[]>();
  holidays.forEach((h) => {
    if (!itemsByDate.has(h.date)) itemsByDate.set(h.date, []);
    itemsByDate.get(h.date)!.push(h);
  });

  return (
    <div className="grid grid-cols-7 gap-2">
      {weekdays.map((w, i) => (
        <div key={w} className={cn(
          "text-center text-sm font-semibold py-2",
          i === 0 && "text-destructive",
          i === 6 && "text-blue-600",
        )}>{w}</div>
      ))}
      {cells.map((iso, idx) => {
        if (!iso) return <div key={idx} className="min-h-[160px]" />;
        const day = Number(iso.slice(-2));
        const isHQ = hqDates.has(iso);
        const isLeader = leaderDates.has(iso);
        const isToday = iso === today;
        const koreanHolidayName = getKoreanHolidayName(iso);
        const dow = new Date(iso + "T00:00:00").getDay();
        const items = itemsByDate.get(iso) || [];
        return (
          <div
            key={idx}
            className={cn(
              "min-h-[160px] border rounded-md p-2 text-sm flex flex-col gap-1",
              koreanHolidayName && !isHQ && !isLeader && "bg-red-100 border-red-500",
              isHQ && "bg-destructive/20 border-destructive",
              !isHQ && isLeader && "bg-yellow-200 border-yellow-400",
              isToday && "ring-2 ring-primary",
            )}
          >
            <div className={cn(
              "font-bold text-lg leading-none",
              dow === 0 && "text-destructive",
              dow === 6 && "text-blue-600",
              koreanHolidayName && "text-red-700",
            )}>{day}</div>
            {koreanHolidayName && (
              <div className="truncate text-xs font-bold text-red-700">
                {koreanHolidayName}
              </div>
            )}
            <div className="flex-1 overflow-hidden space-y-0.5">
              {items.slice(0, 3).map((h) => (
                <div key={h.id} className="truncate text-xs">
                  {h.scope === "hq" ? "본사" : leaderNameById.get(h.team_leader_id || "") || "팀장"}
                </div>
              ))}
              {items.length > 3 && <div className="text-xs text-muted-foreground">+{items.length - 3}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}