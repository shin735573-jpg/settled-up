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
import { ClipboardPaste, Trash2, Plus, X, CalendarIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { fmt, parseNum, parseDate } from "@/lib/format";
import { toast } from "sonner";
import { ko } from "date-fns/locale";
import { canonicalLeaderName, getDisplayName } from "@/lib/leaderResolver";
import {
  validateAll,
  comparePeriodTotals,
  summarize,
  type DeliveryRecord as ValRecord,
  type ValidationIssue,
  type ValidationContext,
} from "@/lib/recordValidation";
import { AlertTriangle, CheckCircle2, ShieldAlert, FileWarning } from "lucide-react";

type Company = {
  id: string;
  name: string;
  active: boolean;
  rejected_leader_id?: string | null;
  rejected_leader_id_2?: string | null;
  rejected_leader_id_3?: string | null;
};
type Leader = { id: string; name: string; is_rejected: boolean; is_virtual: boolean; active: boolean; aliases?: string[] | null };
type Holiday = { date: string; scope: string; team_leader_id: string | null };
type Delivery = any;

const COLS = ["날짜","업체","팀장1","팀장2","고객명","배송지","품목","비고","수도권배송비","비고금액","지방배송비","착불","배송비총액","분할","결제유무"];

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
  { key: "region",   label: "배송지",                       aliases: ["배송지","지역","배송지역","지역명","region"] },
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

// "항목: 값" 형식 자동 인식 → 헤더 + 데이터 행 grid로 변환
// 블록(빈 줄 구분) 하나 = 한 건. 값이 "빈칸"이면 빈 문자열로.
function tryParseKeyValueText(raw: string): string[][] | null {
  const aliasToKey = new Map<string, FieldKey>();
  for (const def of FIELD_DEFS) for (const a of def.aliases) aliasToKey.set(normalizeHeader(a), def.key);
  // 비어있지 않은 줄만 (블록 구분은 키 중복으로 판단 — 빈 줄 유무 무관)
  const rawLines = raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return null;
  const KV_RE = /^([^:：\t]+)\s*[:：]\s*(.*)$/;
  const kvCount = rawLines.filter((l) => KV_RE.test(l)).length;
  // 전체 비어있지 않은 줄 중 80% 이상이 "키: 값" 형식이어야 KV 모드로 인정
  if (kvCount < Math.max(1, Math.ceil(rawLines.length * 0.8))) return null;

  const parsedBlocks: Record<string, string>[] = [];
  const keyOrder: string[] = [];
  let knownHits = 0;
  let cur: Record<string, string> = {};
  const flush = () => {
    if (Object.keys(cur).length > 0) { parsedBlocks.push(cur); cur = {}; }
  };
  for (const l of rawLines) {
    const m = l.match(KV_RE);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (val === "빈칸") val = "";
    // 같은 키가 다시 나오면 새 레코드 시작
    if (key in cur) flush();
    cur[key] = val;
    if (!keyOrder.includes(key)) keyOrder.push(key);
    if (aliasToKey.has(normalizeHeader(key))) knownHits++;
  }
  flush();
  if (knownHits === 0 || parsedBlocks.length === 0) return null;
  const header = keyOrder;
  const rows = parsedBlocks.map((rec) => header.map((h) => rec[h] ?? ""));
  return [header, ...rows];
}

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
    // 사용자 등록 별칭
    for (const a of l.aliases ?? []) {
      const at = String(a ?? "").trim();
      if (at) add(at, l.id);
    }
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
  region_type: RegionType;
  item: string;
  note: string;
  metro_fee: string;
  note_amount: string;
  regional_fee: string;
  cod_amount: string;
  split_type: string;
  paid: boolean;
  two_person: boolean;
  is_missing: boolean;
  missing_reason: string;
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
  region_type: "unknown",
  item: "",
  note: "",
  metro_fee: "",
  note_amount: "",
  regional_fee: "",
  cod_amount: "",
  split_type: "",
  paid: false,
  two_person: false,
  is_missing: false,
  missing_reason: "",
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
  const [validation, setValidation] = useState<{
    issues: ValidationIssue[];
    summary: ReturnType<typeof summarize>;
    periodChecks: ReturnType<typeof comparePeriodTotals>;
    ranAt: string;
  } | null>(null);
  const [showOnly, setShowOnly] = useState<"all" | "error" | "warning">("all");

  const load = async () => {
    const [{ data: c }, { data: l }, { data: h }] = await Promise.all([
      supabase.from("companies").select("id,name,active,rejected_leader_id,rejected_leader_id_2,rejected_leader_id_3").order("name"),
      supabase.from("team_leaders").select("id,name,is_rejected,is_virtual,active,aliases").order("name"),
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
  // 거부기사도 선택 가능 (저장 시 별칭 적용 — 경고만 표시)
  const selectableLeaders = useMemo(() => leaders.filter((l) => l.active), [leaders]);

  // 표시명: 가능하면 leader_id로 정식 팀장명을 찾아 표시(동명이인 구분 포함).
  // ID가 없거나 매칭 실패면 저장된 원본 이름 사용.
  const leadersById = useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);
  const displayLeaderById = (id: string | null, fallback: string | null): string => {
    if (id) {
      const l = leadersById.get(id);
      if (l) return getDisplayName(l, leaders);
    }
    return fallback || "-";
  };

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
      region_type: (r.region_type as RegionType) || classifyRegion(r.region || ""),
      item: r.item || "",
      note: r.note || "",
      metro_fee: String(r.metro_fee ?? ""),
      note_amount: String(r.note_amount ?? ""),
      regional_fee: String(r.regional_fee ?? ""),
      cod_amount: String(r.cod_amount ?? ""),
      split_type: r.split_type || "",
      paid: !!r.paid,
      two_person: !!(r as any).two_person,
      is_missing: !!r.is_missing,
      missing_reason: r.missing_reason || "",
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveForm = async () => {
    if (!user) return;
    if (!form.date) { toast.error("날짜를 입력하세요"); return; }
    const company = companies.find((c) => c.id === form.company_id);
    if (!company) { toast.error("업체를 선택하세요"); return; }
    if (form.is_missing && !form.missing_reason.trim()) {
      toast.error("누락 사유를 입력해주세요"); return;
    }
    // 누락분 모드에서는 저장 직전 자동 검사
    if (form.is_missing) {
      const leaderName = (id: string) => leaders.find((l) => l.id === id)?.name || null;
      const draft: ValRecord = {
        id: form.id || "_draft",
        date: form.date,
        company_id: form.company_id,
        company_name: company.name,
        leader1_id: form.leader1_id || null,
        leader1_name: leaderName(form.leader1_id),
        leader2_id: form.leader2_id || null,
        leader2_name: leaderName(form.leader2_id),
        customer_name: form.customer_name || null,
        region: form.region || null,
        region_type: form.region_type === "unknown" ? null : form.region_type,
        item: form.item || null,
        note: form.note || null,
        metro_fee: parseNum(form.metro_fee) || 0,
        note_amount: parseNum(form.note_amount) || 0,
        regional_fee: parseNum(form.regional_fee) || 0,
        cod_amount: parseNum(form.cod_amount) || 0,
        split_type: form.split_type || null,
        paid: form.paid,
        two_person: form.two_person,
        is_missing: true,
      };
      const ctx: ValidationContext = {
        companies: companies.map((c) => ({ id: c.id, name: c.name })),
        leaders: leaders.map((l) => ({ id: l.id, name: l.name, is_rejected: l.is_rejected })),
        holidays: holidays.map((h) => ({ date: h.date, scope: h.scope as any, team_leader_id: h.team_leader_id })),
        classifyRegion,
      };
      const issues = validateAll([draft], ctx);
      const errs = issues.filter((i) => i.severity === "error");
      const warns = issues.filter((i) => i.severity === "warning");
      if (errs.length > 0) {
        toast.error(`누락분 저장 불가: ${errs.map((e) => e.message).join(" / ")}`);
        return;
      }
      if (warns.length > 0) {
        if (!confirm(`경고 ${warns.length}건:\n${warns.map((w) => `- ${w.message}`).join("\n")}\n\n그대로 저장할까요?`)) return;
      }
    }
    const metroN = parseNum(form.metro_fee) || 0;
    const regionalN = parseNum(form.regional_fee) || 0;
    if (!form.region) {
      if (!confirm("배송지가 비어있습니다. 그대로 저장할까요?")) return;
    }
    if (form.region_type === "metro" && regionalN > 0 && metroN === 0) {
      if (!confirm("지역구분이 수도권인데 지방배송비만 입력되어 있습니다. 그대로 저장할까요?")) return;
    }
    if (form.region_type === "regional" && metroN > 0 && regionalN === 0) {
      if (!confirm("지역구분이 지방인데 수도권배송비만 입력되어 있습니다. 그대로 저장할까요?")) return;
    }
    if (form.two_person && !form.leader2_id) {
      toast.error("2인배송은 팀장2가 필요합니다.");
      return;
    }
    if (!form.two_person && form.leader2_id) {
      if (!confirm("팀장2가 입력되어 있습니다. 2인배송 여부를 확인해주세요. 그대로 저장할까요?")) return;
    }
    if (form.split_type === "3분할") {
      const names = [form.leader1_id, form.leader2_id]
        .map((id) => leaders.find((l) => l.id === id)?.name);
      if (names.includes("신동석")) {
        if (!confirm("신동석이 포함된 건에 ‘3분할’이 선택되어 있습니다. 신동석 재분배 규칙과 충돌합니다. 그대로 저장할까요?")) return;
      }
    }
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
      region_type: form.region_type === "unknown" ? null : form.region_type,
      item: form.item || null,
      note: form.note || null,
      metro_fee: metroN,
      note_amount: parseNum(form.note_amount) || 0,
      regional_fee: regionalN,
      cod_amount: parseNum(form.cod_amount) || 0,
      split_type: form.split_type || null,
      paid: form.paid,
      two_person: form.two_person,
      is_missing: form.is_missing,
      missing_reason: form.is_missing ? (form.missing_reason || null) : null,
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

  // 종합 오류 검사 실행
  const runValidation = () => {
    const ctx: ValidationContext = {
      companies: companies.map((c) => ({ id: c.id, name: c.name })),
      leaders: leaders.map((l) => ({
        id: l.id, name: l.name, is_rejected: l.is_rejected,
        is_virtual: l.is_virtual, active: l.active, aliases: l.aliases ?? [],
      })),
      holidays: holidays.map((h) => ({
        date: h.date, scope: h.scope as any, team_leader_id: h.team_leader_id,
      })),
      classifyRegion,
    };
    const recs = records as ValRecord[];
    const issues = validateAll(recs, ctx, (r) => `${r.date || "?"} ${r.company_name || ""} ${r.customer_name || ""}`);
    const s = summarize(issues, recs.length);
    const periodChecks = comparePeriodTotals(recs, filterMonth);
    setValidation({
      issues,
      summary: s,
      periodChecks,
      ranAt: new Date().toLocaleString("ko-KR"),
    });
    if (s.errorCount === 0 && s.warningCount === 0)
      toast.success(`전체 ${s.totalRows}건 모두 정상`);
    else
      toast.message(`검사 완료: 오류 ${s.errorCount} / 경고 ${s.warningCount} / 정상 ${s.okCount}`);
  };

  const startMissing = () => {
    setForm({ ...emptyForm(), is_missing: true });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.message("누락분 모드 — 누락 사유를 함께 입력해주세요");
  };

  // rowId → 이슈 그룹
  const issuesByRow = useMemo(() => {
    const m = new Map<string, ValidationIssue[]>();
    if (!validation) return m;
    for (const i of validation.issues) {
      if (!m.has(i.rowId)) m.set(i.rowId, []);
      m.get(i.rowId)!.push(i);
    }
    return m;
  }, [validation]);

  const visibleIssueRows = useMemo(() => {
    if (!validation) return [] as { rowId: string; severity: "error" | "warning"; items: ValidationIssue[] }[];
    return Array.from(issuesByRow.entries()).map(([rowId, items]) => ({
      rowId,
      items,
      severity: items.some((i) => i.severity === "error") ? ("error" as const) : ("warning" as const),
    })).filter((g) => showOnly === "all" || g.severity === showOnly);
  }, [issuesByRow, validation, showOnly]);

  const hasErrors = (validation?.summary.errorCount ?? 0) > 0;
  const hasPeriodMismatch = (validation?.periodChecks || []).some((p) => p.status === "불일치");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold flex-1">기록입력</h1>
        <Input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="w-40" />
        <Button onClick={() => setPasteOpen(true)}><ClipboardPaste className="h-4 w-4 mr-1" />엑셀 붙여넣기</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button
          size="lg"
          variant="default"
          className="h-14 text-base font-semibold"
          onClick={runValidation}
        >
          <ShieldAlert className="h-5 w-5 mr-2" /> 오류 검사
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="h-14 text-base font-semibold"
          onClick={startMissing}
        >
          <FileWarning className="h-5 w-5 mr-2" /> 누락분 추가
        </Button>
      </div>

      {validation && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-muted-foreground">검사 시각: {validation.ranAt}</div>
            <Button size="sm" variant="ghost" onClick={() => setValidation(null)}>닫기</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              className={cn("rounded-md border p-3 text-left", showOnly === "all" && "ring-2 ring-primary")}
              onClick={() => setShowOnly("all")}
            >
              <div className="text-xs text-muted-foreground">전체</div>
              <div className="text-2xl font-bold">{validation.summary.totalRows}</div>
            </button>
            <button
              className={cn("rounded-md border p-3 text-left bg-destructive/5", showOnly === "error" && "ring-2 ring-destructive")}
              onClick={() => setShowOnly("error")}
            >
              <div className="text-xs text-destructive">오류</div>
              <div className="text-2xl font-bold text-destructive">{validation.summary.errorCount}</div>
            </button>
            <button
              className={cn("rounded-md border p-3 text-left bg-orange-500/5", showOnly === "warning" && "ring-2 ring-orange-500")}
              onClick={() => setShowOnly("warning")}
            >
              <div className="text-xs text-orange-600">경고</div>
              <div className="text-2xl font-bold text-orange-600">{validation.summary.warningCount}</div>
            </button>
            <div className="rounded-md border p-3 bg-green-500/5">
              <div className="text-xs text-green-700">정상</div>
              <div className="text-2xl font-bold text-green-700">{validation.summary.okCount}</div>
            </div>
          </div>

          {/* #13 기간별 총액 비교 */}
          <div className="border rounded p-3">
            <div className="text-sm font-semibold mb-2">기간별 업체 vs 팀장 총액 ({filterMonth})</div>
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>기간</TableHead>
                  <TableHead className="text-right">업체 배송비 총액</TableHead>
                  <TableHead className="text-right">팀장 배송비 총액</TableHead>
                  <TableHead className="text-right">차이</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {validation.periodChecks.map((p) => (
                  <TableRow key={p.period}>
                    <TableCell>{p.period === "1-15" ? "1~15일" : p.period === "16-end" ? "16~말일" : "월전체"}</TableCell>
                    <TableCell className="text-right">{fmt(p.companyTotal)}</TableCell>
                    <TableCell className="text-right">{fmt(p.leaderTotal)}</TableCell>
                    <TableCell className={cn("text-right", p.diff !== 0 && "text-destructive font-semibold")}>{fmt(p.diff)}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "정상" ? "secondary" : "destructive"}>{p.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {hasPeriodMismatch && (
              <div className="text-xs text-destructive mt-2">
                ⚠ 업체 총액과 팀장 총액이 불일치합니다. 불일치 상태에서는 정산마감을 권장하지 않습니다.
              </div>
            )}
          </div>

          {visibleIssueRows.length > 0 ? (
            <div className="border rounded max-h-96 overflow-y-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>행</TableHead>
                    <TableHead>심각도</TableHead>
                    <TableHead>오류 종류</TableHead>
                    <TableHead>내용</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleIssueRows.flatMap((g) =>
                    g.items.map((it, i) => {
                      const rec = records.find((r) => r.id === g.rowId);
                      return (
                        <TableRow key={g.rowId + i}
                          className={cn(
                            it.severity === "error" ? "bg-destructive/5" : "bg-orange-500/5"
                          )}>
                          <TableCell className="whitespace-nowrap">{it.rowLabel || g.rowId.slice(0, 6)}</TableCell>
                          <TableCell>
                            {it.severity === "error"
                              ? <Badge variant="destructive">오류</Badge>
                              : <Badge className="bg-orange-500 hover:bg-orange-600">경고</Badge>}
                          </TableCell>
                          <TableCell className="font-mono text-[10px]">{it.code}</TableCell>
                          <TableCell>{it.message}</TableCell>
                          <TableCell>
                            {rec && (
                              <Button size="sm" variant="outline" onClick={() => editRow(rec)}>수정</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-700 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              {showOnly === "all" ? "이슈가 없습니다 — 모든 행 정상." : `해당 필터에 항목이 없습니다.`}
            </div>
          )}

          {hasErrors && (
            <div className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              오류가 있는 상태에서는 저장/정산마감이 차단됩니다. 행 [수정] 버튼으로 보정 후 다시 검사하세요.
            </div>
          )}
        </Card>
      )}

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
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {form.id ? "배송 수정" : (form.is_missing ? "누락분 추가" : "새 배송 입력")}
              {form.is_missing && <Badge className="bg-orange-500 hover:bg-orange-600">누락분</Badge>}
            </h2>
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
                          {l.name}{l.is_rejected ? " (거부기사·별칭표시)" : ""}
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
              <Label>배송지</Label>
              <Input
                value={form.region}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm({ ...form, region: v, region_type: classifyRegion(v) });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>지역구분</Label>
              <Select
                value={form.region_type}
                onValueChange={(v) => setForm({ ...form, region_type: v as RegionType })}
              >
                <SelectTrigger className={form.region_type === "unknown" ? "border-destructive text-destructive" : ""}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="metro">수도권</SelectItem>
                  <SelectItem value="regional">지방</SelectItem>
                  <SelectItem value="unknown">미분류</SelectItem>
                </SelectContent>
              </Select>
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
            <div className="space-y-1">
              <Label>2인배송</Label>
              <Select
                value={form.two_person ? "yes" : "no"}
                onValueChange={(v) => setForm({ ...form, two_person: v === "yes" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">아니오</SelectItem>
                  <SelectItem value="yes">예</SelectItem>
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
            <div className="space-y-1 sm:col-span-2 lg:col-span-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_missing}
                  onCheckedChange={(v) => setForm({ ...form, is_missing: !!v })}
                />
                <span className="font-medium">누락분 (정산일 이후 추가 등록)</span>
              </label>
              {form.is_missing && (
                <Input
                  className="mt-2"
                  placeholder="누락 사유 (필수)"
                  value={form.missing_reason}
                  onChange={(e) => setForm({ ...form, missing_reason: e.target.value })}
                />
              )}
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
              {["구분","날짜","업체","팀장1","팀장2","고객","배송지","지역구분","품목","비고","수도권","비고금액","지방","착불","총액","2인배송","분할","결제",""].map((h) => (
                <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => {
              const total = Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
              const rowIssues = issuesByRow.get(r.id);
              const rowSeverity = rowIssues?.some((i) => i.severity === "error")
                ? "error" : rowIssues?.length ? "warning" : null;
              return (
                <TableRow key={r.id} className={cn(
                  "cursor-pointer",
                  rowSeverity === "error" && "bg-destructive/5",
                  rowSeverity === "warning" && "bg-orange-500/5",
                )} onClick={() => editRow(r)}>
                  <TableCell className="whitespace-nowrap">
                    {r.is_missing
                      ? <Badge className="bg-orange-500 hover:bg-orange-600">누락분</Badge>
                      : <Badge variant="secondary">일반</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.company_name}</TableCell>
                  <TableCell className="whitespace-nowrap">{displayLeaderById(r.leader1_id, r.leader1_name)}</TableCell>
                  <TableCell className="whitespace-nowrap">{displayLeaderById(r.leader2_id, r.leader2_name)}</TableCell>
                  <TableCell>{r.customer_name || "-"}</TableCell>
                  <TableCell>{r.region || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.region_type === "metro" ? "수도권" : r.region_type === "regional" ? "지방" : "-"}
                  </TableCell>
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
                  <TableCell className="whitespace-nowrap">
                    {r.two_person ? <Badge className="bg-blue-500 hover:bg-blue-600">2인배송</Badge> : "-"}
                  </TableCell>
                  <TableCell>{r.split_type || "-"}</TableCell>
                  <TableCell>{r.paid ? "✓" : "-"}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); removeRow(r.id); }}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              );
            })}
            {records.length === 0 && <TableRow><TableCell colSpan={19} className="text-center py-8 text-muted-foreground">기록이 없습니다. 위 새 배송입력 또는 엑셀 붙여넣기로 추가하세요.</TableCell></TableRow>}
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
        defaultMonth={filterMonth}
        onSaved={() => { setPasteOpen(false); load(); }}
        onReload={load}
      />
    </div>
  );
}

type RowError = { field: string; msg: string };
type ParsedRow = {
  raw: string[];
  rawDate: string;
  autoDate: string | null;
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

function PasteDialog({ open, onClose, companies, leaders, holidays, userId, defaultMonth, onSaved, onReload }: {
  open: boolean; onClose: () => void; companies: Company[]; leaders: Leader[]; holidays: Holiday[]; userId: string; defaultMonth?: string; onSaved: () => void; onReload: () => void | Promise<void>;
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
  // 행별 날짜 수동 입력 (raw 텍스트). undefined = 자동, 그 외 = 사용자 입력
  const [dateOverrides, setDateOverrides] = useState<Record<number, string>>({});
  // 일괄 적용용 입력값
  const [bulkDate, setBulkDate] = useState("");
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
    const kv = tryParseKeyValueText(text);
    if (kv) return kv;
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

      const rawDate = cell(cols, "date");
      const autoDate = parseDate(rawDate, defaultMonth);
      // 날짜 fill-down/오류 처리는 effective 단계에서 수행 (사용자 수정 반영)
      const date = autoDate;

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
      // 인식 실패 시: 원문을 정식 이름으로 정규화 시도 (별칭/공백 흡수). 매칭 실패하면 trim 원문.
      const fallbackNames: (string | null)[] = [
        cell(cols, "leader1") ? canonicalLeaderName(cell(cols, "leader1"), leaders) : null,
        cell(cols, "leader2") ? canonicalLeaderName(cell(cols, "leader2"), leaders) : null,
      ];
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
        raw: cols, rawDate, autoDate, company,
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
  const effective = useMemo(() => {
    let lastDate: string | null = null;
    return parsed.map((r, i) => {
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
    const errors = [...r.errors];
    // 날짜: 사용자 입력 > 자동인식 > 위 행 fill-down
    const ovDate = dateOverrides[i];
    let date: string | null = null;
    let dateInputValue = "";
    if (ovDate !== undefined) {
      dateInputValue = ovDate;
      const parsed = parseDate(ovDate, defaultMonth);
      if (ovDate.trim() && !parsed) {
        errors.push({ field: "날짜", msg: `날짜 형식 오류: ${ovDate}` });
      }
      date = parsed;
    } else if (r.autoDate) {
      date = r.autoDate;
      dateInputValue = r.autoDate;
    }
    if (!date && lastDate) date = lastDate;
    if (!date) errors.push({ field: "날짜", msg: "날짜 누락 — 직접 입력" });
    else lastDate = date;
    if (!r.region) warnings.push({ field: "배송지", msg: "배송지 빈칸 — 확인 필요" });
    if (regionType === "metro" && r.regional > 0 && r.metro === 0) {
      warnings.push({ field: "지역구분", msg: "수도권인데 지방배송비만 입력됨" });
    }
    if (regionType === "regional" && r.metro > 0 && r.regional === 0) {
      warnings.push({ field: "지역구분", msg: "지방인데 수도권배송비만 입력됨" });
    }
    return {
      ...r,
      date,
      dateInputValue,
      leaderIds: [a.id, b.id] as (string | null)[],
      leaders: [a.name, b.name] as (string | null)[],
      regionType,
      errors,
      warnings,
    };
    });
  }, [parsed, leaderOverrides, leaderById, regionOverrides, dateOverrides, defaultMonth]);

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

  // 미등록 팀장 목록
  const VIRTUAL_LEADER_KEYWORDS: string[] = [];
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
    // 날짜 누락 검사 (skipErrors와 무관하게 막음)
    const missingDateCount = visible.filter(({ row }) => !row.date).length;
    if (missingDateCount > 0) {
      toast.error(`날짜가 없는 행 ${missingDateCount}건. 미리보기에서 날짜를 입력해주세요.`);
      return;
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
      region_type: r.regionType === "unknown" ? null : r.regionType,
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
    setDateOverrides({});
    setBulkDate("");
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
                    기본값: 정산포함 · 활성 · 수수료 0%.
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
              <div className="flex flex-wrap items-center gap-2 border rounded p-2 bg-muted/30">
                <span className="text-xs font-semibold">날짜 일괄</span>
                <Input
                  value={bulkDate}
                  onChange={(e) => setBulkDate(e.target.value)}
                  placeholder={defaultMonth ? `${defaultMonth}-01 또는 5/1` : "YYYY-MM-DD"}
                  className="h-7 text-xs w-[160px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const parsed = parseDate(bulkDate, defaultMonth);
                    if (!parsed) { toast.error("날짜 형식 오류"); return; }
                    const next: Record<number, string> = {};
                    for (const { i } of visible) next[i] = parsed;
                    setDateOverrides((p) => ({ ...p, ...next }));
                    toast.success(`${visible.length}건 날짜 ${parsed} 적용`);
                  }}
                >전체 적용</Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // 빈 날짜 행에 위 행의 최종 날짜를 채워넣음 (사용자 override로 고정)
                    let last: string | null = null;
                    const next: Record<number, string> = {};
                    let filled = 0;
                    for (const { row, i } of visible) {
                      if (row.date) { last = row.date; continue; }
                      if (last) { next[i] = last; filled++; }
                    }
                    if (filled === 0) { toast.info("채울 빈 날짜가 없습니다"); return; }
                    setDateOverrides((p) => ({ ...p, ...next }));
                    toast.success(`빈 날짜 ${filled}건 채움`);
                  }}
                >빈 날짜 채우기</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setDateOverrides({}); setBulkDate(""); }}
                >초기화</Button>
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
                      <TableHead className="whitespace-nowrap min-w-[120px]">배송지</TableHead>
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
                                  {l.name}{l.is_rejected ? " (거부기사·별칭표시)" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        );
                      };
                      return (
                        <TableRow key={i} className={hasErr ? "bg-destructive/10" : ""}>
                          <TableCell>{displayIdx + 1}</TableCell>
                          <TableCell className="whitespace-nowrap min-w-[150px]">
                            <div className="flex items-center gap-1">
                              <Input
                                value={r.dateInputValue}
                                onChange={(e) => setDateOverrides((p) => ({ ...p, [i]: e.target.value }))}
                                placeholder={r.autoDate || "YYYY-MM-DD"}
                                className={cn("h-7 text-xs w-[110px]", !r.date && "border-destructive text-destructive")}
                              />
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className={cn("h-7 w-7 shrink-0", !r.date && "text-destructive")}
                                    title="달력으로 선택"
                                  >
                                    <CalendarIcon className="h-3.5 w-3.5" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <Calendar
                                    mode="single"
                                    locale={ko}
                                    selected={r.date ? new Date(r.date + "T00:00:00") : undefined}
                                    defaultMonth={
                                      r.date
                                        ? new Date(r.date + "T00:00:00")
                                        : defaultMonth
                                          ? new Date(defaultMonth + "-01T00:00:00")
                                          : undefined
                                    }
                                    onSelect={(d) => {
                                      if (!d) return;
                                      const y = d.getFullYear();
                                      const m = String(d.getMonth() + 1).padStart(2, "0");
                                      const day = String(d.getDate()).padStart(2, "0");
                                      setDateOverrides((p) => ({ ...p, [i]: `${y}-${m}-${day}` }));
                                    }}
                                    initialFocus
                                    className={cn("p-3 pointer-events-auto")}
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>
                            {r.date && r.dateInputValue && r.date !== r.dateInputValue && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">→ {r.date}</div>
                            )}
                          </TableCell>
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