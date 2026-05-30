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

// 표준 필드 + 별칭 (헤더 자동 인식용)
type FieldKey =
  | "date" | "company" | "leader1" | "leader2" | "customer" | "region"
  | "item" | "note" | "metro" | "noteAmt" | "regional" | "cod" | "split" | "paid";

const FIELD_DEFS: { key: FieldKey; label: string; aliases: string[]; required?: boolean }[] = [
  { key: "date",     label: "날짜",       required: true,  aliases: ["날짜","배송일","일자","출고일","date"] },
  { key: "company",  label: "업체",       required: true,  aliases: ["업체","업체명","거래처","거래처명","상호","회사","회사명","company"] },
  { key: "leader1",  label: "팀장1",                       aliases: ["팀장1","기사1","배송팀장1","팀장","leader1"] },
  { key: "leader2",  label: "팀장2",                       aliases: ["팀장2","기사2","배송팀장2","leader2"] },
  { key: "customer", label: "고객명",                       aliases: ["고객명","고객","성명","이름","성함","받는분","수령인","customer"] },
  { key: "region",   label: "지역",                         aliases: ["지역","배송지역","지역명","region"] },
  { key: "item",     label: "품목",                         aliases: ["품목","상품","제품","품명","내용","item"] },
  { key: "note",     label: "비고",                         aliases: ["비고","메모","특이사항","참고","note"] },
  { key: "metro",    label: "수도권배송비",                  aliases: ["수도권배송비","수도권","수도권비","수도권 배송비","금액","배송비","요금"] },
  { key: "noteAmt",  label: "비고금액",                     aliases: ["비고금액","비고비","추가금","추가비","기타금액"] },
  { key: "regional", label: "지방배송비",                   aliases: ["지방배송비","지방","지방비","지방 배송비"] },
  { key: "cod",      label: "착불",                         aliases: ["착불","착불금액","현장수령","선지급"] },
  { key: "split",    label: "분할",                         aliases: ["분할","분할구분","정산분할"] },
  { key: "paid",     label: "결제유무",                     aliases: ["결제유무","결제","결제확인","결제완료","미결제","paid"] },
];

const normalizeHeader = (s: string) =>
  s.replace(/\s+/g, "").replace(/[()\[\]]/g, "").toLowerCase();

const FIELD_UNMAPPED = "__unmapped__";

// 배송비총액 별칭은 무시 (자동 계산)
const TOTAL_ALIASES = ["배송비총액","총액","합계","total"].map(normalizeHeader);

function autoMapHeaders(headers: string[]): (FieldKey | null)[] {
  const used = new Set<FieldKey>();
  return headers.map((h) => {
    const norm = normalizeHeader(h);
    if (TOTAL_ALIASES.includes(norm)) return null;
    for (const def of FIELD_DEFS) {
      if (used.has(def.key)) continue;
      if (def.aliases.some((a) => normalizeHeader(a) === norm)) {
        used.add(def.key);
        return def.key;
      }
    }
    return null;
  });
}

// 팀장명 자동 인식: 등록된 팀장명 + 자동 별칭(이름의 뒤 2글자, 가운데+끝 2글자)으로 후보 키 생성
function buildLeaderIndex(leaders: Leader[]) {
  const active = leaders.filter((l) => l.active);
  // key -> leader id (충돌 시 해당 key 제거)
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  const add = (key: string, id: string) => {
    if (!key || key.length < 2) return;
    if (ambiguous.has(key)) return;
    if (map.has(key) && map.get(key) !== id) {
      map.delete(key); ambiguous.add(key); return;
    }
    map.set(key, id);
  };
  for (const l of active) {
    const n = l.name.trim();
    add(n, l.id);
    if (n.length >= 3) {
      add(n.slice(-2), l.id);
      add(n.slice(1), l.id);
    }
    if (n.length >= 4) add(n.slice(-3), l.id);
  }
  // 길이 내림차순으로 정렬된 키 목록 (긴 매치 우선)
  const keys = Array.from(map.keys()).sort((a, b) => b.length - a.length);
  return { map, keys };
}

const LEADER_SPLIT_RE = /[\/,&+\s\n]+/g;

// 수도권 키워드: 시/도, 서울 구, 경기/인천 시·구·동
const METRO_KEYWORDS = [
  "서울","경기","인천",
  // 서울 25개 구
  "강남구","강동구","강북구","강서구","관악구","광진구","구로구","금천구","노원구","도봉구",
  "동대문구","동작구","마포구","서대문구","서초구","성동구","성북구","송파구","양천구",
  "영등포구","용산구","은평구","종로구","중랑구",
  // 경기/인천 시·구·동
  "수원","성남","분당","판교","용인","고양","일산","부천","안양","안산","화성","동탄","평택",
  "남양주","의정부","광명","시흥","김포","장기동","구래동","마산동","운양동","풍무동","사우동",
  "양촌","통진","고촌","파주","운정","문산","하남","미사","구리","군포","의왕","오산","이천",
  "안성","포천","양주","동두천","과천","여주","가평","양평","연천",
  "검단","청라","송도","부평","계양","남동구","연수구","미추홀구","강화","영종",
];
// "중구"/"서구"는 다른 지방 도시에도 흔하므로 단독 매칭은 보류 (서울/인천 키워드와 함께일 때만 metro로 판정됨)

export type RegionType = "metro" | "regional" | "unknown";
function classifyRegion(text: string): RegionType {
  const s = (text || "").trim();
  if (!s) return "unknown";
  // 인천/서울 시 표기와 함께 나오는 중구/서구는 수도권
  if (/(서울|인천)/.test(s) && /(중구|서구)/.test(s)) return "metro";
  for (const kw of METRO_KEYWORDS) {
    if (s.includes(kw)) return "metro";
  }
  return "regional";
}

// 텍스트에서 팀장 후보를 순서대로 추출
function extractLeaders(text: string, idx: ReturnType<typeof buildLeaderIndex>): { ids: string[]; raw: string[] } {
  if (!text) return { ids: [], raw: [] };
  // 1) 구분자 분리 시도
  const tokens = text.split(LEADER_SPLIT_RE).map((t) => t.trim()).filter(Boolean);
  type Hit = { id: string; raw: string; pos: number };
  const hits: Hit[] = [];
  const seenIds = new Set<string>();
  const consumeId = (id: string, raw: string, pos: number) => {
    if (seenIds.has(id)) return;
    seenIds.add(id);
    hits.push({ id, raw, pos });
  };

  // 토큰별 정확/별칭 매치
  let cursor = 0;
  for (const tok of tokens) {
    const pos = text.indexOf(tok, cursor);
    cursor = pos >= 0 ? pos + tok.length : cursor;
    if (idx.map.has(tok)) {
      consumeId(idx.map.get(tok)!, tok, pos);
      continue;
    }
    // 토큰 내부에 별칭이 들어있는 경우 (예: "동석님")
    for (const k of idx.keys) {
      if (tok.includes(k)) {
        const p = pos + tok.indexOf(k);
        consumeId(idx.map.get(k)!, k, p);
        break;
      }
    }
  }

  // 2) 구분자 없이 붙어있는 경우(예: "김용익동석") 전체 문자열에서 substring 스캔
  if (hits.length < 2) {
    for (const k of idx.keys) {
      const id = idx.map.get(k)!;
      if (seenIds.has(id)) continue;
      const p = text.indexOf(k);
      if (p >= 0) consumeId(id, k, p);
    }
  }

  hits.sort((a, b) => a.pos - b.pos);
  return { ids: hits.map((h) => h.id), raw: hits.map((h) => h.raw) };
}

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
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

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
        <Plus className="h-5 w-5 mr-2" /> 새 배송 입력
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
            <div className="space-y-1 sm:col-span-2 lg:col-span-4">
              <Label>품목</Label>
              <Textarea
                value={form.item}
                onChange={(e) => setForm({ ...form, item: e.target.value })}
                rows={4}
                className="min-h-[112px] whitespace-pre-wrap break-words"
              />
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
              <Select
                value={form.split_type || "__none__"}
                onValueChange={(v) => setForm({ ...form, split_type: v === "__none__" ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(빈칸)</SelectItem>
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
                  <TableCell
                    className="align-top max-w-[240px] cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedItems((prev) => ({ ...prev, [r.id]: !prev[r.id] }));
                    }}
                    title={r.item || ""}
                  >
                    <div
                      className={`whitespace-pre-wrap break-words ${expandedItems[r.id] ? "" : "line-clamp-3"}`}
                    >
                      {r.item || "-"}
                    </div>
                  </TableCell>
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
        onReload={load}
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
  regionType: RegionType;
  errors: RowError[];
  warnings: RowError[];
};

function PasteDialog({ open, onClose, companies, leaders, holidays, userId, onSaved, onReload }: {
  open: boolean; onClose: () => void; companies: Company[]; leaders: Leader[]; holidays: Holiday[]; userId: string; onSaved: () => void; onReload: () => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  const [skipErrors, setSkipErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  // 기본 팀장 입력 (붙여넣은 행에 팀장이 없을 때 적용)
  const [defaultLeadersText, setDefaultLeadersText] = useState("");
  // 행별 팀장 수동 수정: rowIndex -> { l1?: id|""(=빈칸), l2?: id|"" }
  const [leaderOverrides, setLeaderOverrides] = useState<Record<number, { l1?: string; l2?: string }>>({});
  // 행별 수도권/지방 수동 수정
  const [regionOverrides, setRegionOverrides] = useState<Record<number, RegionType>>({});
  // 미리보기에서 사용자가 제외한 행
  const [excludedRows, setExcludedRows] = useState<Record<number, boolean>>({});

  const leaderIndex = useMemo(() => buildLeaderIndex(leaders), [leaders]);
  const selectableLeaders = useMemo(() => leaders.filter((l) => l.active && !l.is_rejected), [leaders]);
  const leaderById = useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);

  // 기본 팀장 파싱 결과
  const defaultLeaderInfo = useMemo(() => {
    const text = defaultLeadersText.trim();
    if (!text) return { ids: [] as string[], raw: [] as string[], rawTokens: [] as string[], unknown: [] as string[], tooMany: false };
    const extracted = extractLeaders(text, leaderIndex);
    const rawTokens = text.split(LEADER_SPLIT_RE).map((t) => t.trim()).filter(Boolean);
    // 매칭 안 된 토큰 = 미등록 팀장 후보
    const matchedRaw = new Set(extracted.raw);
    const unknown = rawTokens.filter((t) => {
      if (matchedRaw.has(t)) return false;
      // 토큰 안에 매칭된 키가 포함됐는지 확인
      for (const k of leaderIndex.keys) if (t.includes(k)) return false;
      return true;
    });
    return {
      ids: extracted.ids,
      raw: extracted.raw,
      rawTokens,
      unknown,
      tooMany: extracted.ids.length >= 3,
    };
  }, [defaultLeadersText, leaderIndex]);

  // 붙여넣은 원본을 grid로 변환
  const grid = useMemo<string[][]>(() => {
    if (!text.trim()) return [];
    return text.replace(/\r/g, "").split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => l.split("\t").map((c) => c.trim()));
  }, [text]);

  // 헤더 자동 탐색: 첫 ~30행 중 표준 별칭 매칭 점수가 가장 높은 행을 헤더로 채택 (점수 ≥ 2 필요)
  const headerInfo = useMemo(() => {
    if (grid.length === 0) return { hasHeader: false, headers: [] as string[], dataStart: 0 };
    let bestRow = -1, bestScore = 0;
    const limit = Math.min(grid.length, 30);
    for (let i = 0; i < limit; i++) {
      const auto = autoMapHeaders(grid[i]);
      const score = auto.filter((k) => k !== null).length;
      if (score > bestScore) { bestScore = score; bestRow = i; }
    }
    if (bestScore >= 2 && bestRow >= 0) {
      return { hasHeader: true, headers: grid[bestRow], dataStart: bestRow + 1 };
    }
    return { hasHeader: false, headers: [] as string[], dataStart: 0 };
  }, [grid]);

  const colCount = useMemo(
    () => grid.reduce((m, r) => Math.max(m, r.length), 0),
    [grid]
  );

  // 컬럼 매핑 상태 (자동 + 사용자 수정)
  const [mapping, setMapping] = useState<(FieldKey | null)[]>([]);

  useEffect(() => {
    if (colCount === 0) { setMapping([]); return; }
    const auto = headerInfo.hasHeader
      ? autoMapHeaders(headerInfo.headers)
      : new Array(colCount).fill(null);
    // 길이 맞추기
    const arr: (FieldKey | null)[] = new Array(colCount).fill(null);
    for (let i = 0; i < Math.min(auto.length, colCount); i++) arr[i] = auto[i];
    // 헤더 없고 정확히 14개 컬럼이면 기존 순서로 기본 매핑
    if (!headerInfo.hasHeader && colCount >= 14) {
      const fallback: FieldKey[] = ["date","company","leader1","leader2","customer","region","item","note","metro","noteAmt","regional","cod","split","paid"];
      for (let i = 0; i < fallback.length; i++) if (!arr[i]) arr[i] = fallback[i];
    }
    setMapping(arr);
    // eslint-disable-next-line
  }, [text]);

  const missingRequired = useMemo(() => {
    const set = new Set(mapping.filter(Boolean) as FieldKey[]);
    return FIELD_DEFS.filter((f) => f.required && !set.has(f.key)).map((f) => f.label);
  }, [mapping]);

  const parsed = useMemo<ParsedRow[]>(() => {
    if (grid.length === 0 || mapping.length === 0) return [];
    const dataRows = grid.slice(headerInfo.dataStart);
    let lastDate: string | null = null;
    const companyMap = new Map(companies.map((c) => [c.name.trim(), c]));
    const holidayHQ = new Set(holidays.filter((h) => h.scope === "hq").map((h) => h.date));
    const holidayLeader = new Set(holidays.filter((h) => h.scope === "leader").map((h) => `${h.date}|${h.team_leader_id}`));

    // 필드 → 컬럼 인덱스
    const idx: Partial<Record<FieldKey, number>> = {};
    mapping.forEach((k, i) => { if (k && idx[k] === undefined) idx[k] = i; });
    const cell = (row: string[], k: FieldKey) => {
      const i = idx[k]; return i === undefined ? "" : (row[i] ?? "").trim();
    };
    // 팀장 자동 인식에 사용할 텍스트 후보: leader1/leader2 셀 + (그 셀이 비어있으면) 매핑 안 된 모든 셀
    const collectLeaderText = (row: string[]) => {
      const parts: string[] = [];
      const l1 = cell(row, "leader1"); if (l1) parts.push(l1);
      const l2 = cell(row, "leader2"); if (l2) parts.push(l2);
      if (parts.length === 0) {
        // 미매핑 셀들에서 후보를 찾는다
        for (let i = 0; i < row.length; i++) if (!mapping[i]) {
          const v = (row[i] ?? "").trim();
          if (v) parts.push(v);
        }
      }
      return parts.join("\n");
    };

    // 노이즈 행 키워드 (합계/안내/정산완료 등)
    const SKIP_KEYWORDS = ["합계","총계","소계","계","정산완료","입금완료","계좌","은행","연락처","담당자","비고없음","주의","안내","총합","TOTAL","SUM"];
    const isSkipRow = (row: string[]) => {
      const joined = row.join(" ").trim();
      if (!joined) return true;
      const nonEmpty = row.filter((c) => (c ?? "").trim() !== "").length;
      // 한 셀짜리 제목/안내 행
      if (nonEmpty <= 1 && joined.length > 0) return true;
      // 키워드 행
      for (const kw of SKIP_KEYWORDS) {
        if (joined.includes(kw)) return true;
      }
      // 반복 패턴(예: "==========", "------")
      if (/^[=\-_\s*]+$/.test(joined)) return true;
      return false;
    };

    return dataRows.map((cols) => {
      if (isSkipRow(cols)) return null;
      const errors: RowError[] = [];
      const warnings: RowError[] = [];

      let date = parseDate(cell(cols, "date"));
      if (!date && lastDate) date = lastDate;
      if (!date) errors.push({ field: "날짜", msg: "날짜 형식 오류" });
      else lastDate = date;

      const company = cell(cols, "company");
      if (!company) errors.push({ field: "업체", msg: "업체 누락" });
      const companyRec = companyMap.get(company);
      if (company && !companyRec) errors.push({ field: "업체", msg: "미등록 업체" });

      // 팀장 자동 인식
      const leaderText = collectLeaderText(cols);
      const extracted = extractLeaders(leaderText, leaderIndex);
      // 행 안에서 팀장 인식 실패 시 기본 팀장 입력란 값 적용
      const usedDefault = extracted.ids.length === 0 && defaultLeaderInfo.ids.length > 0;
      const effectiveIds = usedDefault ? defaultLeaderInfo.ids : extracted.ids;
      let leaderIds: (string | null)[] = [effectiveIds[0] || null, effectiveIds[1] || null];
      // 인식 실패 시: leader1/leader2 셀 원문 그대로 (미등록 경고용)
      const fallbackNames: (string | null)[] = [cell(cols, "leader1") || null, cell(cols, "leader2") || null];
      const leaderNames: (string | null)[] = leaderIds.map((id, i) =>
        id ? leaderById.get(id)?.name || null : fallbackNames[i]
      );
      // 미등록 팀장: 텍스트에는 이름이 있는데 매칭 실패한 경우
      if (!usedDefault && leaderText && extracted.ids.length === 0 && leaderText.replace(LEADER_SPLIT_RE, "").length > 0) {
        errors.push({ field: "팀장", msg: `미등록 팀장: ${leaderText}` });
      }
      if (effectiveIds.length >= 3) {
        warnings.push({ field: "팀장", msg: `${effectiveIds.length}명 인식 — 앞 2명만 사용 (팀장3 미사용)` });
      }
      if (usedDefault) {
        warnings.push({ field: "팀장", msg: "기본 팀장 적용" });
      }
      // 거부/휴무 검사
      leaderIds.forEach((id, i) => {
        const rec = id ? leaderById.get(id) : null;
        if (rec?.is_rejected) errors.push({ field: `팀장${i + 1}`, msg: `거부팀장 배정 불가: ${rec.name}` });
        if (date && rec && holidayLeader.has(`${date}|${rec.id}`)) {
          errors.push({ field: `팀장${i + 1}`, msg: `${rec.name} 휴무일` });
        }
      });
      if (date && holidayHQ.has(date)) warnings.push({ field: "날짜", msg: "본사 휴무일" });

      const customer = cell(cols, "customer");
      const region = cell(cols, "region");
      const item = cell(cols, "item");
      const note = cell(cols, "note");

      const checkNum = (raw: string, label: string) => {
        if (raw === "") return 0;
        const cleaned = raw.replace(/,/g, "").trim();
        if (cleaned !== "" && isNaN(Number(cleaned))) errors.push({ field: label, msg: `숫자 오류: ${raw}` });
        return parseNum(raw);
      };
      const metro = checkNum(cell(cols, "metro"), "수도권배송비");
      const noteAmt = checkNum(cell(cols, "noteAmt"), "비고금액");
      const regional = checkNum(cell(cols, "regional"), "지방배송비");
      const cod = checkNum(cell(cols, "cod"), "착불");

      const splitRaw = cell(cols, "split");
      const split = ["", "3분할", "형주동석"].includes(splitRaw) ? splitRaw : splitRaw;
      const paidRaw = cell(cols, "paid").toLowerCase();
      const paid = ["o", "y", "yes", "true", "완료", "결제", "✓", "v", "결제완료"].includes(paidRaw) || paidRaw === "1";

      // 실제 배송 행 판단: 신호 ≥ 2개
      let signals = 0;
      if (date) signals++;
      if (company) signals++;
      if (leaderIds.some(Boolean)) signals++;
      if (customer) signals++;
      if (item) signals++;
      if (metro + noteAmt + regional + cod > 0) signals++;
      // 자동감지된 행은 모두 미리보기에 표시 (오류/경고는 컬럼으로 안내).
      // 단, 아무 신호도 없는 완전 빈 행만 제외.
      if (signals < 1) return null;

      // 신호가 충분한데 날짜만 없으면 위 lastDate가 fill-down 처리됨 (이미 위에서 적용)

      return {
        raw: cols, date, company,
        leaders: leaderNames,
        customer, region, item, note,
        metro, noteAmt, regional, cod,
        split, paid,
        companyId: companyRec?.id || null,
        leaderIds,
        regionType: classifyRegion(region),
        errors, warnings,
      } as ParsedRow;
    }).filter((r): r is ParsedRow => r !== null);
  }, [grid, mapping, headerInfo, companies, leaders, holidays, leaderIndex, leaderById, defaultLeaderInfo]);

  // 사용자 수정 반영된 최종 팀장 적용
  const effective = useMemo(() => parsed.map((r, i) => {
    const ov = leaderOverrides[i] || {};
    const applyOne = (autoId: string | null, autoName: string | null, ovVal: string | undefined) => {
      if (ovVal === undefined) return { id: autoId, name: autoName };
      if (ovVal === "") return { id: null, name: null };
      const rec = leaderById.get(ovVal);
      return { id: rec?.id || null, name: rec?.name || null };
    };
    const a = applyOne(r.leaderIds[0], r.leaders[0], ov.l1);
    const b = applyOne(r.leaderIds[1], r.leaders[1], ov.l2);
    // 수도권/지방 override 반영 + 지역 경고
    const regionType: RegionType = regionOverrides[i] ?? r.regionType;
    const warnings = [...r.warnings];
    if (!r.region) warnings.push({ field: "지역", msg: "지역 빈칸 — 확인 필요" });
    if (regionType === "metro" && r.regional > 0 && r.metro === 0) {
      warnings.push({ field: "지역", msg: "수도권인데 지방배송비만 입력됨" });
    }
    if (regionType === "regional" && r.metro > 0 && r.regional === 0) {
      warnings.push({ field: "지역", msg: "지방인데 수도권배송비만 입력됨" });
    }
    return {
      ...r,
      leaderIds: [a.id, b.id] as (string | null)[],
      leaders: [a.name, b.name] as (string | null)[],
      regionType,
      warnings,
    };
  }), [parsed, leaderOverrides, leaderById, regionOverrides]);

  const visible = useMemo(
    () => effective.map((r, i) => ({ row: r, i })).filter(({ i }) => !excludedRows[i]),
    [effective, excludedRows]
  );
  const errorCount = visible.filter(({ row }) => row.errors.length).length;

  // 미등록 업체 목록 (붙여넣기 데이터 기준, 중복 제거, 공백 제거)
  const unregisteredCompanies = useMemo(() => {
    const set = new Set<string>();
    for (const { row } of visible) {
      const name = (row.company || "").trim();
      if (!name) continue;
      if (row.companyId) continue;
      set.add(name);
    }
    return Array.from(set);
  }, [visible]);

  const registerCompanies = async () => {
    if (!userId || unregisteredCompanies.length === 0) return;
    setRegistering(true);
    const rows = unregisteredCompanies.map((name) => ({
      user_id: userId,
      name,
      active: true,
      issues_invoice: false,
      vat_included: false,
      fee_rate_metro: 0,
      fee_rate_regional: 0,
    }));
    const { error } = await supabase.from("companies").insert(rows);
    setRegistering(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length}개 업체 자동등록 완료`);
    await onReload();
  };

  // 미등록 팀장 목록 (가상기사/가상팀장 제외)
  const VIRTUAL_LEADER_KEYWORDS = ["가상기사", "가상팀장", "가상"];
  const unregisteredLeaders = useMemo(() => {
    const set = new Set<string>();
    const add = (raw: string) => {
      const tokens = raw.split(LEADER_SPLIT_RE).map((t) => t.trim()).filter(Boolean);
      for (const t of tokens) {
        if (!t) continue;
        if (VIRTUAL_LEADER_KEYWORDS.some((k) => t.includes(k))) continue;
        if (leaderIndex.map.has(t)) continue;
        let matched = false;
        for (const k of leaderIndex.keys) if (t.includes(k)) { matched = true; break; }
        if (matched) continue;
        set.add(t);
      }
    };
    for (const { row } of visible) {
      for (const e of row.errors) {
        if (e.field === "팀장" && e.msg.startsWith("미등록 팀장:")) {
          add(e.msg.replace("미등록 팀장:", ""));
        }
      }
    }
    for (const u of defaultLeaderInfo.unknown) add(u);
    return Array.from(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leaderIndex, defaultLeaderInfo]);

  const registerLeaders = async () => {
    if (!userId || unregisteredLeaders.length === 0) return;
    setRegistering(true);
    const rows = unregisteredLeaders.map((name) => ({
      user_id: userId,
      name,
      active: true,
      is_rejected: false,
      is_virtual: false,
      deduction_amount: 0,
      trash_cost: 0,
    }));
    const { error } = await supabase.from("team_leaders").insert(rows);
    setRegistering(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length}명 팀장 자동등록 완료`);
    await onReload();
  };

  const save = async () => {
    if (!userId) return;
    if (missingRequired.length > 0) {
      toast.error(`필수 항목 누락: ${missingRequired.join(", ")}`); return;
    }
    const toSave = visible.map(({ row }) => row).filter((r) => skipErrors ? !r.errors.length : true);
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
    setLeaderOverrides({});
    setRegionOverrides({});
    setExcludedRows({});
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-y-auto sm:max-w-[98vw]">
        <DialogHeader>
          <DialogTitle>엑셀 붙여넣기 (자동 분류)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            엑셀에서 복사하면 첫 줄의 컬럼명을 읽어 자동 분류합니다. 컬럼 순서가 달라도 됩니다.<br/>
            • 컬럼명이 없거나 인식 안 된 열은 아래 “컬럼 매핑”에서 직접 지정 • 날짜가 빈칸이면 바로 위 날짜 자동 적용 • 금액은 쉼표 허용 • 배송비총액은 자동 계산 (붙여넣기 값 무시)
          </div>

          <div className="border rounded p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm font-semibold">기본 팀장</Label>
              <div className="text-xs text-muted-foreground">
                행에 팀장이 없을 때 자동 적용 · 구분자: / , &amp; + 공백 줄바꿈
              </div>
            </div>
            <Input
              value={defaultLeadersText}
              onChange={(e) => setDefaultLeadersText(e.target.value)}
              placeholder="예) 동석/형주  또는  오동선, 김용익"
            />
            {defaultLeadersText.trim() && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {defaultLeaderInfo.ids.slice(0, 2).map((id, i) => {
                  const rec = leaderById.get(id);
                  return (
                    <Badge key={id} variant="secondary">
                      팀장{i + 1}: {rec?.name || "?"}
                    </Badge>
                  );
                })}
                {defaultLeaderInfo.ids.length === 1 && (
                  <span className="text-muted-foreground">팀장2는 빈칸</span>
                )}
                {defaultLeaderInfo.tooMany && (
                  <Badge variant="destructive">
                    {defaultLeaderInfo.ids.length}명 입력 — 앞 2명만 사용. 미리보기에서 확인하세요.
                  </Badge>
                )}
                {defaultLeaderInfo.unknown.map((u) => (
                  <Badge key={u} variant="destructive">미등록: {u}</Badge>
                ))}
              </div>
            )}
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="엑셀에서 헤더 포함 여러 행/열을 복사해 붙여넣으세요 (Ctrl+V)"
            rows={8}
            wrap="off"
            className="font-mono text-xs whitespace-pre overflow-x-auto"
          />

          {grid.length > 0 && (
            <div className="border rounded p-3 space-y-2">
              <div className="text-sm font-semibold">
                컬럼 매핑 {headerInfo.hasHeader ? "(헤더 자동 인식됨)" : "(헤더 미인식 — 직접 지정)"}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {Array.from({ length: colCount }).map((_, i) => {
                  const headerText = headerInfo.hasHeader ? (headerInfo.headers[i] ?? "") : `열 ${i + 1}`;
                  const sample = (grid[headerInfo.dataStart]?.[i] ?? "").slice(0, 20);
                  const val = mapping[i] ?? FIELD_UNMAPPED;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="text-xs text-muted-foreground truncate" title={headerText}>
                        <b>{headerText || `열 ${i + 1}`}</b>
                        {sample && <span className="ml-1 opacity-70">예: {sample}</span>}
                      </div>
                      <Select
                        value={val as string}
                        onValueChange={(v) => {
                          const next = [...mapping];
                          next[i] = v === FIELD_UNMAPPED ? null : (v as FieldKey);
                          // 다른 열이 같은 필드면 해제
                          if (v !== FIELD_UNMAPPED) {
                            for (let j = 0; j < next.length; j++) if (j !== i && next[j] === v) next[j] = null;
                          }
                          setMapping(next);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FIELD_UNMAPPED}>(사용 안 함)</SelectItem>
                          {FIELD_DEFS.map((f) => (
                            <SelectItem key={f.key} value={f.key}>
                              {f.label}{f.required ? " *" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
              {missingRequired.length > 0 && (
                <div className="text-xs text-destructive font-semibold">
                  필수 항목 누락: {missingRequired.join(", ")}
                </div>
              )}
            </div>
          )}

          {effective.length > 0 && (
            <>
              {unregisteredCompanies.length > 0 && (
                <div className="border border-destructive/40 bg-destructive/5 rounded p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-sm font-semibold text-destructive">
                      미등록 업체 자동등록 ({unregisteredCompanies.length}개)
                    </div>
                    <Button size="sm" onClick={registerCompanies} disabled={registering}>
                      {registering ? "등록 중…" : "미등록 업체 일괄 등록"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {unregisteredCompanies.map((n) => (
                      <Badge key={n} variant="outline" className="border-destructive/50 text-destructive">{n}</Badge>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    기본값: 계산서 미발행 · 활성 · 수수료 0%. 등록 후 설정 화면에서 계산서 여부·정산 정보를 수정하세요.
                  </div>
                </div>
              )}
              {unregisteredLeaders.length > 0 && (
                <div className="border border-destructive/40 bg-destructive/5 rounded p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-sm font-semibold text-destructive">
                      미등록 팀장 자동등록 ({unregisteredLeaders.length}명)
                    </div>
                    <Button size="sm" onClick={registerLeaders} disabled={registering}>
                      {registering ? "등록 중…" : "미등록 팀장 일괄 등록"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {unregisteredLeaders.map((n) => (
                      <Badge key={n} variant="outline" className="border-destructive/50 text-destructive">{n}</Badge>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    기본값: 정산포함 · 활성 · 수수료 0%. 가상기사/가상팀장은 자동 등록되지 않습니다.
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  자동감지 <b>{effective.length}</b>건 · 미리보기 <b>{visible.length}</b>건 · 오류 <span className="text-destructive font-semibold">{errorCount}</span>건
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={skipErrors} onCheckedChange={(v) => setSkipErrors(!!v)} />
                  정상 행만 저장
                </label>
              </div>
              <div className="overflow-x-auto border rounded min-h-[500px]">
                <Table className="text-xs num w-max min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap min-w-[40px]">#</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">날짜</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[140px]">업체</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">팀장1</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">팀장2</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">고객명</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px]">지역</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[110px]">지역구분</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[220px]">품목</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[220px]">비고</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px] text-right">수도권배송비</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px] text-right">비고금액</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px] text-right">지방배송비</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[120px] text-right">착불</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[130px] text-right">배송비총액</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">분할</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[100px]">결제유무</TableHead>
                      <TableHead className="whitespace-nowrap min-w-[220px]">오류/경고</TableHead>
                      <TableHead className="min-w-[48px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map(({ row: r, i }, displayIdx) => {
                      const total = r.metro + r.noteAmt + r.regional;
                      const hasErr = r.errors.length > 0;
                      const leaderCell = (slot: 0 | 1) => {
                        const key = slot === 0 ? "l1" : "l2";
                        const ovVal = leaderOverrides[i]?.[key];
                        const current = ovVal !== undefined ? ovVal : (r.leaderIds[slot] || "");
                        const unknown = !current && !!r.leaders[slot];
                        return (
                          <Select
                            value={current || NONE}
                            onValueChange={(v) => setLeaderOverrides((prev) => ({
                              ...prev,
                              [i]: { ...prev[i], [key]: v === NONE ? "" : v },
                            }))}
                          >
                            <SelectTrigger className={`h-7 text-xs min-w-[110px] ${unknown ? "border-destructive text-destructive" : ""}`}>
                              <SelectValue placeholder={r.leaders[slot] || "선택 안 함"} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>(빈칸)</SelectItem>
                              {selectableLeaders.map((l) => (
                                <SelectItem key={l.id} value={l.id}>
                                  {l.name}{l.is_virtual ? " (가상)" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );
                      };
                      return (
                        <TableRow key={i} className={hasErr ? "bg-destructive/10" : ""}>
                          <TableCell>{displayIdx + 1}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.date || "-"}</TableCell>
                          <TableCell className="min-w-[140px] whitespace-nowrap">{r.company || "-"}</TableCell>
                          <TableCell>{leaderCell(0)}</TableCell>
                          <TableCell>{leaderCell(1)}</TableCell>
                          <TableCell className="min-w-[120px] whitespace-nowrap">{r.customer || "-"}</TableCell>
                          <TableCell className="min-w-[120px] whitespace-nowrap">{r.region || "-"}</TableCell>
                          <TableCell className="min-w-[110px]">
                            <Select
                              value={r.regionType}
                              onValueChange={(v) => setRegionOverrides((p) => ({ ...p, [i]: v as RegionType }))}
                            >
                              <SelectTrigger className={`h-7 text-xs min-w-[100px] ${r.regionType === "unknown" ? "border-destructive text-destructive" : ""}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="metro">수도권</SelectItem>
                                <SelectItem value="regional">지방</SelectItem>
                                <SelectItem value="unknown">미분류</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="min-w-[220px] max-w-[360px] whitespace-pre-wrap break-words align-top">{r.item || "-"}</TableCell>
                          <TableCell className="min-w-[220px] max-w-[360px] whitespace-pre-wrap break-words align-top">{r.note || "-"}</TableCell>
                          <TableCell className="text-right">{fmt(r.metro)}</TableCell>
                          <TableCell className="text-right">{fmt(r.noteAmt)}</TableCell>
                          <TableCell className="text-right">{fmt(r.regional)}</TableCell>
                          <TableCell className="text-right">{fmt(r.cod)}</TableCell>
                          <TableCell className="text-right font-semibold">{fmt(total)}</TableCell>
                          <TableCell>{r.split || "-"}</TableCell>
                          <TableCell>{r.paid ? "✓" : "-"}</TableCell>
                          <TableCell className="space-y-1 min-w-[220px]">
                            {r.errors.map((e, j) => <Badge key={j} variant="destructive" className="mr-1">{e.field}: {e.msg}</Badge>)}
                            {r.warnings.map((w, j) => <Badge key={"w"+j} variant="secondary" className="mr-1">{w.field}: {w.msg}</Badge>)}
                          </TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" title="이 행 제외"
                              onClick={() => setExcludedRows((p) => ({ ...p, [i]: true }))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {Object.keys(excludedRows).length > 0 && (
                <div className="text-xs">
                  <button className="underline text-muted-foreground" onClick={() => setExcludedRows({})}>
                    제외한 {Object.keys(excludedRows).length}개 행 복원
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={saving || visible.length === 0 || missingRequired.length > 0}>
            {skipErrors ? `정상 ${visible.length - errorCount}건 저장` : `${visible.length}건 저장`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}