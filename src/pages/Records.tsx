import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardPaste, Trash2, Plus, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { fmt, parseNum, parseDate } from "@/lib/format";
import { toast } from "sonner";

type Company = { id: string; name: string; active: boolean };
type Leader = { id: string; name: string; is_rejected: boolean; is_virtual: boolean; active: boolean };
type Holiday = { date: string; scope: string; team_leader_id: string | null };
type Delivery = any;

const COLS = ["날짜","업체","팀장1","팀장2","고객명","지역","품목","비고","수도권배송비","비고금액","지방배송비","착불","배송비총액","분할","결제유무"];

type FormState = {
  id: string | null;
  date: string;
  company_id: string;
  leader1_id: string;
  leader2_id: string;
  customer_name: string;
  region: string;
  item: string;
  note: string;
  metro_fee: string;
  note_amount: string;
  regional_fee: string;
  cod_amount: string;
  split_type: string;
  paid: boolean;
};

const NONE = "__none__";

const emptyForm = (): FormState => ({
  id: null,
  date: new Date().toISOString().slice(0, 10),
  company_id: "",
  leader1_id: "",
  leader2_id: "",
  customer_name: "",
  region: "",
  item: "",
  note: "",
  metro_fee: "",
  note_amount: "",
  regional_fee: "",
  cod_amount: "",
  split_type: "",
  paid: false,
});

export default function Records() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [records, setRecords] = useState<Delivery[]>([]);
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: c }, { data: l }, { data: h }] = await Promise.all([
      supabase.from("companies").select("id,name,active").order("name"),
      supabase.from("team_leaders").select("id,name,is_rejected,is_virtual,active").order("name"),
      supabase.from("holidays").select("date,scope,team_leader_id"),
    ]);
    setCompanies((c as Company[]) || []);
    setLeaders((l as Leader[]) || []);
    setHolidays((h as Holiday[]) || []);
    const start = filterMonth + "-01";
    const next = new Date(filterMonth + "-01"); next.setMonth(next.getMonth() + 1);
    const end = next.toISOString().slice(0, 10);
    const { data: d } = await supabase.from("deliveries").select("*").gte("date", start).lt("date", end).order("date").order("created_at");
    setRecords(d || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterMonth]);

  const removeRow = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("deliveries").delete().eq("id", id);
    if (form.id === id) setForm(emptyForm());
    load();
  };

  const activeCompanies = useMemo(() => companies.filter((c) => c.active), [companies]);
  const selectableLeaders = useMemo(() => leaders.filter((l) => l.active && !l.is_rejected), [leaders]);

  const total =
    (parseNum(form.metro_fee) || 0) +
    (parseNum(form.note_amount) || 0) +
    (parseNum(form.regional_fee) || 0);

  const editRow = (r: Delivery) => {
    setForm({
      id: r.id,
      date: r.date,
      company_id: r.company_id || "",
      leader1_id: r.leader1_id || "",
      leader2_id: r.leader2_id || "",
      customer_name: r.customer_name || "",
      region: r.region || "",
      item: r.item || "",
      note: r.note || "",
      metro_fee: String(r.metro_fee ?? ""),
      note_amount: String(r.note_amount ?? ""),
      regional_fee: String(r.regional_fee ?? ""),
      cod_amount: String(r.cod_amount ?? ""),
      split_type: r.split_type || "",
      paid: !!r.paid,
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveForm = async () => {
    if (!user) return;
    if (!form.date) { toast.error("날짜를 입력하세요"); return; }
    const company = companies.find((c) => c.id === form.company_id);
    if (!company) { toast.error("업체를 선택하세요"); return; }
    const leaderName = (id: string) => leaders.find((l) => l.id === id)?.name || null;
    const payload = {
      user_id: user.id,
      date: form.date,
      company_id: form.company_id,
      company_name: company.name,
      leader1_id: form.leader1_id || null,
      leader1_name: leaderName(form.leader1_id),
      leader2_id: form.leader2_id || null,
      leader2_name: leaderName(form.leader2_id),
      customer_name: form.customer_name || null,
      region: form.region || null,
      item: form.item || null,
      note: form.note || null,
      metro_fee: parseNum(form.metro_fee) || 0,
      note_amount: parseNum(form.note_amount) || 0,
      regional_fee: parseNum(form.regional_fee) || 0,
      cod_amount: parseNum(form.cod_amount) || 0,
      split_type: form.split_type || null,
      paid: form.paid,
    };
    setSaving(true);
    let error;
    if (form.id) {
      ({ error } = await supabase.from("deliveries").update(payload).eq("id", form.id));
    } else {
      ({ error } = await supabase.from("deliveries").insert(payload));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(form.id ? "수정 완료" : "저장 완료");
    setForm(emptyForm());
    load();
  };

  const deleteForm = async () => {
    if (!form.id) { toast.error("삭제할 기록을 먼저 선택하세요"); return; }
    await removeRow(form.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold flex-1">기록입력</h1>
        <Input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="w-40" />
        <Button onClick={() => setPasteOpen(true)}><ClipboardPaste className="h-4 w-4 mr-1" />엑셀 붙여넣기</Button>
      </div>

      <Button
        size="lg"
        className="w-full h-14 text-base font-semibold"
        onClick={() => { setForm(emptyForm()); setFormOpen(true); }}
      >
        <Plus className="h-5 w-5 mr-2" /> 새 배송입력
      </Button>

      {formOpen && (
        <Card className="p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{form.id ? "배송 수정" : "새 배송 입력"}</h2>
            <Button variant="ghost" size="icon" onClick={() => { setForm(emptyForm()); setFormOpen(false); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>날짜</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>업체</Label>
              <Select value={form.company_id} onValueChange={(v) => setForm({ ...form, company_id: v })}>
                <SelectTrigger><SelectValue placeholder="업체 선택" /></SelectTrigger>
                <SelectContent>
                  {activeCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {[0, 1].map((i) => {
              const key = (`leader${i + 1}_id`) as "leader1_id" | "leader2_id";
              return (
                <div key={i} className="space-y-1">
                  <Label>팀장{i + 1}</Label>
                  <Select
                    value={form[key] || NONE}
                    onValueChange={(v) => setForm({ ...form, [key]: v === NONE ? "" : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="선택 안 함" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>선택 안 함</SelectItem>
                      {selectableLeaders.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}{l.is_virtual ? " (가상)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}

            <div className="space-y-1">
              <Label>고객명</Label>
              <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>지역</Label>
              <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>품목</Label>
              <Input value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2 lg:col-span-4">
              <Label>비고</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>수도권배송비</Label>
              <Input inputMode="numeric" value={form.metro_fee} onChange={(e) => setForm({ ...form, metro_fee: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>비고금액</Label>
              <Input inputMode="numeric" value={form.note_amount} onChange={(e) => setForm({ ...form, note_amount: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>지방배송비</Label>
              <Input inputMode="numeric" value={form.regional_fee} onChange={(e) => setForm({ ...form, regional_fee: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>착불</Label>
              <Input inputMode="numeric" value={form.cod_amount} onChange={(e) => setForm({ ...form, cod_amount: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>배송비총액 (자동)</Label>
              <Input value={fmt(total)} readOnly className="bg-muted font-semibold" />
            </div>
            <div className="space-y-1">
              <Label>분할</Label>
              <Select value={form.split_type} onValueChange={(v) => setForm({ ...form, split_type: v })}>
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">(빈칸)</SelectItem>
                  <SelectItem value="3분할">3분할</SelectItem>
                  <SelectItem value="형주동석">형주동석</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex flex-col">
              <Label>결제유무</Label>
              <label className="flex items-center gap-2 h-10 px-3 border rounded-md cursor-pointer">
                <Checkbox checked={form.paid} onCheckedChange={(v) => setForm({ ...form, paid: !!v })} />
                <span>{form.paid ? "결제 완료" : "미결제"}</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            <Button size="lg" className="h-12 text-base" onClick={saveForm} disabled={saving || !!form.id}>
              저장
            </Button>
            <Button size="lg" className="h-12 text-base" variant="secondary" onClick={saveForm} disabled={saving || !form.id}>
              수정
            </Button>
            <Button size="lg" className="h-12 text-base" variant="destructive" onClick={deleteForm} disabled={saving || !form.id}>
              삭제
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <Table className="text-xs num">
          <TableHeader>
            <TableRow>
              {["날짜","업체","팀장1","팀장2","고객","지역","품목","비고","수도권","비고금액","지방","착불","총액","분할","결제",""].map((h) => (
                <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => {
              const total = Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => editRow(r)}>
                  <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.company_name}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.leader1_name || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.leader2_name || "-"}</TableCell>
                  <TableCell>{r.customer_name || "-"}</TableCell>
                  <TableCell>{r.region || "-"}</TableCell>
                  <TableCell>{r.item || "-"}</TableCell>
                  <TableCell>{r.note || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(r.metro_fee)}</TableCell>
                  <TableCell className="text-right">{fmt(r.note_amount)}</TableCell>
                  <TableCell className="text-right">{fmt(r.regional_fee)}</TableCell>
                  <TableCell className="text-right">{fmt(r.cod_amount)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(total)}</TableCell>
                  <TableCell>{r.split_type || "-"}</TableCell>
                  <TableCell>{r.paid ? "✓" : "-"}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); removeRow(r.id); }}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              );
            })}
            {records.length === 0 && <TableRow><TableCell colSpan={16} className="text-center py-8 text-muted-foreground">기록이 없습니다. 위 새 배송입력 또는 엑셀 붙여넣기로 추가하세요.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <PasteDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        companies={companies}
        leaders={leaders}
        holidays={holidays}
        userId={user?.id || ""}
        onSaved={() => { setPasteOpen(false); load(); }}
      />
    </div>
  );
}

type RowError = { field: string; msg: string };
type ParsedRow = {
  raw: string[];
  date: string | null;
  company: string;
  leaders: (string | null)[];
  customer: string; region: string; item: string; note: string;
  metro: number; noteAmt: number; regional: number; cod: number;
  split: string; paid: boolean;
  companyId: string | null;
  leaderIds: (string | null)[];
  errors: RowError[];
  warnings: RowError[];
};

function PasteDialog({ open, onClose, companies, leaders, holidays, userId, onSaved }: {
  open: boolean; onClose: () => void; companies: Company[]; leaders: Leader[]; holidays: Holiday[]; userId: string; onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [skipErrors, setSkipErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo<ParsedRow[]>(() => {
    if (!text.trim()) return [];
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
    let lastDate: string | null = null;
    const companyMap = new Map(companies.map((c) => [c.name.trim(), c]));
    const leaderMap = new Map(leaders.map((l) => [l.name.trim(), l]));
    const holidayHQ = new Set(holidays.filter((h) => h.scope === "hq").map((h) => h.date));
    const holidayLeader = new Set(holidays.filter((h) => h.scope === "leader").map((h) => `${h.date}|${h.team_leader_id}`));

    return lines.map((line) => {
      const cols = line.split("\t");
      const get = (i: number) => (cols[i] ?? "").trim();
      const errors: RowError[] = [];
      const warnings: RowError[] = [];

      // date
      let date = parseDate(get(0));
      if (!date && lastDate) date = lastDate;
      if (!date) errors.push({ field: "날짜", msg: "날짜 형식 오류" });
      else lastDate = date;

      const company = get(1);
      if (!company) errors.push({ field: "업체", msg: "업체 누락" });
      const companyRec = companyMap.get(company);
      if (company && !companyRec) errors.push({ field: "업체", msg: "미등록 업체" });

      const leaderNames = [get(2), get(3)].map((n) => n || null);
      const leaderRecs = leaderNames.map((n) => (n ? leaderMap.get(n) || null : null));
      leaderNames.forEach((n, i) => {
        if (n && !leaderRecs[i]) errors.push({ field: `팀장${i + 1}`, msg: `미등록 팀장: ${n}` });
        if (leaderRecs[i]?.is_rejected) errors.push({ field: `팀장${i + 1}`, msg: `거부팀장 배정 불가: ${n}` });
        if (date && leaderRecs[i]) {
          if (holidayLeader.has(`${date}|${leaderRecs[i]!.id}`)) errors.push({ field: `팀장${i + 1}`, msg: `${n} 휴무일` });
        }
      });
      if (date && holidayHQ.has(date)) warnings.push({ field: "날짜", msg: "본사 휴무일" });

      const customer = get(4);
      const region = get(5);
      const item = get(6);
      const note = get(7);

      const metroRaw = get(8), noteAmtRaw = get(9), regionalRaw = get(10), codRaw = get(11);
      const checkNum = (raw: string, label: string) => {
        if (raw === "") return 0;
        const cleaned = raw.replace(/,/g, "").trim();
        if (cleaned !== "" && isNaN(Number(cleaned))) errors.push({ field: label, msg: `숫자 오류: ${raw}` });
        return parseNum(raw);
      };
      const metro = checkNum(metroRaw, "수도권배송비");
      const noteAmt = checkNum(noteAmtRaw, "비고금액");
      const regional = checkNum(regionalRaw, "지방배송비");
      const cod = checkNum(codRaw, "착불");

      const split = get(12);
      const paidRaw = get(13).toLowerCase();
      const paid = ["o", "y", "yes", "true", "완료", "결제", "✓", "v"].includes(paidRaw) || paidRaw === "1";

      return {
        raw: cols, date, company,
        leaders: leaderNames,
        customer, region, item, note,
        metro, noteAmt, regional, cod,
        split, paid,
        companyId: companyRec?.id || null,
        leaderIds: leaderRecs.map((r) => r?.id || null),
        errors, warnings,
      };
    });
  }, [text, companies, leaders, holidays]);

  const errorCount = parsed.filter((r) => r.errors.length).length;

  const save = async () => {
    if (!userId) return;
    const toSave = skipErrors ? parsed.filter((r) => !r.errors.length) : parsed;
    if (!skipErrors && errorCount > 0) { toast.error("오류가 있어 저장 불가. 정상 행만 저장 옵션을 사용하세요."); return; }
    if (toSave.length === 0) { toast.error("저장할 행이 없습니다"); return; }
    setSaving(true);
    const rows = toSave.map((r) => ({
      user_id: userId,
      date: r.date!,
      company_id: r.companyId,
      company_name: r.company,
      leader1_id: r.leaderIds[0], leader1_name: r.leaders[0],
      leader2_id: r.leaderIds[1], leader2_name: r.leaders[1],
      customer_name: r.customer || null,
      region: r.region || null,
      item: r.item || null,
      note: r.note || null,
      metro_fee: r.metro, note_amount: r.noteAmt, regional_fee: r.regional, cod_amount: r.cod,
      split_type: r.split || null, paid: r.paid,
    }));
    const { error } = await supabase.from("deliveries").insert(rows);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length}건 저장 완료`);
    setText("");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>엑셀 붙여넣기</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            열 순서: {COLS.join(" / ")}<br />
            • 날짜가 빈칸이면 바로 위 날짜를 자동 적용 • 금액은 쉼표 허용 • 배송비총액은 자동 계산
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="엑셀에서 복사한 데이터를 여기에 붙여넣으세요 (Ctrl+V)"
            rows={6}
            className="font-mono text-xs"
          />
          {parsed.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  총 <b>{parsed.length}</b>건 / 오류 <span className="text-destructive font-semibold">{errorCount}</span>건
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={skipErrors} onCheckedChange={(v) => setSkipErrors(!!v)} />
                  정상 행만 저장
                </label>
              </div>
              <div className="overflow-x-auto border rounded">
                <Table className="text-xs num">
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>날짜</TableHead><TableHead>업체</TableHead>
                      <TableHead>팀장1</TableHead><TableHead>팀장2</TableHead><TableHead>팀장3</TableHead>
                      <TableHead>고객</TableHead><TableHead>지역</TableHead>
                      <TableHead>수도권</TableHead><TableHead>비고금액</TableHead><TableHead>지방</TableHead>
                      <TableHead>총액</TableHead><TableHead>착불</TableHead>
                      <TableHead>오류/경고</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.map((r, i) => {
                      const total = r.metro + r.noteAmt + r.regional;
                      const hasErr = r.errors.length > 0;
                      return (
                        <TableRow key={i} className={hasErr ? "bg-destructive/10" : ""}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.date || "-"}</TableCell>
                          <TableCell>{r.company || "-"}</TableCell>
                          <TableCell>{r.leaders[0] || "-"}</TableCell>
                          <TableCell>{r.leaders[1] || "-"}</TableCell>
                          <TableCell>{r.leaders[2] || "-"}</TableCell>
                          <TableCell>{r.customer || "-"}</TableCell>
                          <TableCell>{r.region || "-"}</TableCell>
                          <TableCell className="text-right">{fmt(r.metro)}</TableCell>
                          <TableCell className="text-right">{fmt(r.noteAmt)}</TableCell>
                          <TableCell className="text-right">{fmt(r.regional)}</TableCell>
                          <TableCell className="text-right font-semibold">{fmt(total)}</TableCell>
                          <TableCell className="text-right">{fmt(r.cod)}</TableCell>
                          <TableCell className="space-y-1">
                            {r.errors.map((e, j) => <Badge key={j} variant="destructive" className="mr-1">{e.field}: {e.msg}</Badge>)}
                            {r.warnings.map((w, j) => <Badge key={"w"+j} variant="secondary" className="mr-1">{w.field}: {w.msg}</Badge>)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={saving || parsed.length === 0}>
            {skipErrors ? `정상 ${parsed.length - errorCount}건 저장` : `${parsed.length}건 저장`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}