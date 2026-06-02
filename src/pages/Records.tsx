import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useArrowKeyNav } from "@/hooks/useArrowKeyNav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardPaste, Trash2, Plus, X, CalendarIcon, Camera, Loader2, ScanSearch } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CompanyCombobox } from "@/components/CompanyCombobox";
import { LeaderCombobox } from "@/components/LeaderCombobox";
import { AmountTextInput } from "@/components/AmountTextInput";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { fmt, parseNum, parseDate } from "@/lib/format";
import { toast } from "sonner";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { canonicalLeaderName, getDisplayName } from "@/lib/leaderResolver";
import {
  classifyRegion as classifyRegionBase,
  loadMetroKeywords,
  saveMetroKeywords,
  isDongOnly,
  type RegionType as RegionTypeShared,
} from "@/lib/regionClassifier";
import {
  validateAll,
  comparePeriodTotals,
  summarize,
  type DeliveryRecord as ValRecord,
  type ValidationIssue,
  type ValidationContext,
} from "@/lib/recordValidation";
import { AlertTriangle, CheckCircle2, ShieldAlert, FileWarning } from "lucide-react";
import OcrCheckPanel, { type ExtractedRow } from "@/components/OcrCheckPanel";
import { isSkippablePasteRow, parsePastedTableText } from "@/lib/pasteGrid";
import { useSaveConfirm } from "@/components/SaveConfirmDialog";

type Company = {
  id: string;
  name: string;
  active: boolean;
  has_cod?: boolean;
  rejected_leader_id?: string | null;
  rejected_leader_id_2?: string | null;
  rejected_leader_id_3?: string | null;
};
type Leader = { id: string; name: string; is_rejected: boolean; is_virtual: boolean; active: boolean; aliases?: string[] | null; settle_to_id?: string | null };
type Holiday = { date: string; scope: string; team_leader_id: string | null };
type Delivery = any;

const COLS = ["날짜","업체","팀장1","팀장2","팀장3","고객명","배송지","지역구분","품목","비고","수도권배송비","비고금액","지방배송비","착불","배송비총액","2인배송","분할","결제유무"];

// 표준 필드 + 별칭 (헤더 자동 인식용)
type FieldKey =
  | "date" | "company" | "leader1" | "leader2" | "leader3" | "customer" | "region"
  | "item" | "note" | "metro" | "noteAmt" | "regional" | "cod" | "split" | "paid"
  | "twoPerson";

const FIELD_DEFS: { key: FieldKey; label: string; aliases: string[]; required?: boolean }[] = [
  { key: "date",     label: "날짜",       required: true,  aliases: ["날짜","배송일","일자","출고일","date"] },
  { key: "company",  label: "업체",       required: true,  aliases: ["업체","업체명","거래처","거래처명","상호","회사","회사명","company"] },
  { key: "leader1",  label: "팀장1",                       aliases: ["팀장1","기사1","배송팀장1","팀장","leader1"] },
  { key: "leader2",  label: "팀장2",                       aliases: ["팀장2","기사2","배송팀장2","leader2"] },
  { key: "leader3",  label: "팀장3",                       aliases: ["팀장3","기사3","배송팀장3","leader3"] },
  { key: "customer", label: "고객명",                       aliases: ["고객명","고객","성명","이름","성함","받는분","수령인","customer"] },
  { key: "region",   label: "배송지",                       aliases: ["배송지","지역","배송지역","지역명","주소","배송주소","region","address"] },
  { key: "item",     label: "품목",                         aliases: ["품목","상품","제품","품명","내용","모델","모델명","item","model"] },
  { key: "note",     label: "비고",                         aliases: ["비고","메모","특이사항","참고","note"] },
  { key: "metro",    label: "수도권배송비",                  aliases: ["수도권배송비","수도권","수도권비","수도권 배송비","금액","배송비","요금"] },
  { key: "noteAmt",  label: "비고금액",                     aliases: ["비고금액","비고비","추가금","추가비","기타금액"] },
  { key: "regional", label: "지방배송비",                   aliases: ["지방배송비","지방","지방비","지방 배송비"] },
  { key: "cod",      label: "착불",                         aliases: ["착불","착불금액","현장수령","선지급"] },
  { key: "split",    label: "분할",                         aliases: ["분할","분할구분","정산분할"] },
  { key: "paid",     label: "결제유무",                     aliases: ["결제유무","결제","결제확인","결제완료","미결제","paid"] },
  { key: "twoPerson", label: "2인배송",                     aliases: ["2인배송","이인배송","2인","2인작업","two_person","twoperson"] },
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

/**
 * 주문 메모(자유 형식) 텍스트에서 고객명/주소/품목/날짜/배송비/착불/연락처 등을
 * 추출하여 "키:값" 블록 형태의 문자열로 반환. 기존 KV 파서에 그대로 전달 가능.
 * 예) "일산메종드르블랑\n고객명:문지연\n주소:대구...\n모델:식탁\n배송비 12만원 고객님착불\n배송일:6월5일(금)"
 */
function parseOrderMemoToKV(raw: string): string | null {
  const text = (raw || "").replace(/\r/g, "").trim();
  if (!text) return null;
  const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!rawLines.length) return null;

  const out: Record<string, string> = {};
  const extraNotes: string[] = [];
  let firstFreeLine = "";

  // 한국어 날짜 "6월5일", "6/5", "06-05" → 올해 기준 YYYY-MM-DD
  const toIsoDate = (v: string): string | null => {
    const s = v.replace(/\s+/g, "");
    let m = s.match(/(\d{1,2})월\s*(\d{1,2})일?/);
    if (!m) m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})/);
    if (!m) {
      const iso = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
      if (iso) {
        const y = iso[1], mm = iso[2].padStart(2, "0"), dd = iso[3].padStart(2, "0");
        return `${y}-${mm}-${dd}`;
      }
      return null;
    }
    const y = new Date().getFullYear();
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  };

  const KV_RE = /^([^:：]+)\s*[:：]\s*(.*)$/;
  const NUM_KO = /(\d+(?:[\.,]\d+)?)\s*만\s*원?/;

  for (const rawLine of rawLines) {
    // 강조 마커(**, *) 제거
    const line = rawLine.replace(/^\*+\s*/, "").replace(/\s*\*+$/, "").trim();
    if (!line) continue;

    const m = line.match(KV_RE);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      const k = normalizeHeader(key);
      if (["고객명","고객","성명","이름","성함","받는분","수령인"].some((a) => normalizeHeader(a) === k)) {
        out["고객명"] = val;
      } else if (["주소","배송지","배송주소","지역","지역명","address"].some((a) => normalizeHeader(a) === k)) {
        out["배송지"] = val;
      } else if (["모델","모델명","품목","상품","제품","품명","내용"].some((a) => normalizeHeader(a) === k)) {
        out["품목"] = val;
      } else if (["배송일","날짜","일자","출고일"].some((a) => normalizeHeader(a) === k)) {
        out["날짜"] = toIsoDate(val) || val;
      } else if (["업체","업체명","거래처","상호","회사","회사명"].some((a) => normalizeHeader(a) === k)) {
        out["업체"] = val;
      } else if (["연락처","전화","전화번호","휴대폰","핸드폰","phone","tel"].some((a) => normalizeHeader(a) === k)) {
        extraNotes.push(`연락처: ${val}`);
      } else {
        extraNotes.push(`${key}: ${val}`);
      }
      continue;
    }

    // 콜론 없는 자유 라인
    // 배송비 + 만원 + 착불 → 착불 금액
    const feeKo = line.match(NUM_KO);
    const isFeeLine = /배송비|운임|요금/.test(line);
    const isCod = /착불|현장수령|현장지급/.test(line);
    if (feeKo && (isFeeLine || isCod)) {
      const won = Math.round(parseFloat(feeKo[1].replace(/,/g, "")) * 10000);
      if (isCod) out["착불"] = String(won);
      else out["수도권배송비"] = String(won);
      // 원본 메모도 비고에 남김
      extraNotes.push(line);
      continue;
    }
    // 첫 자유 라인은 업체명 후보로 사용
    if (!firstFreeLine) {
      firstFreeLine = line;
      continue;
    }
    extraNotes.push(line);
  }

  if (firstFreeLine && !out["업체"]) out["업체"] = firstFreeLine;
  if (extraNotes.length) out["비고"] = extraNotes.join(" / ");

  // 필드가 아무것도 추출되지 않으면 실패
  if (Object.keys(out).length === 0) return null;

  // KV 블록 문자열로 직렬화
  return Object.entries(out)
    .map(([k, v]) => `${k}:${v}`)
    .join("\n");
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

// 지역 분류기 — 설정에서 키워드 편집 가능 (regionClassifier.ts)
export type RegionType = RegionTypeShared;
// 모듈 레벨 키워드 캐시. useAuth로 uid가 확정되면 RecordsPage에서 갱신.
let __metroKeywords: string[] | null = null;
export function setMetroKeywordsCache(list: string[]) { __metroKeywords = list; }
function classifyRegion(text: string): RegionType {
  return classifyRegionBase(text, __metroKeywords || undefined);
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
  leader3_id: string;
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
  revisit_required: boolean;
  revisit_done: boolean;
  revisit_group_id: string | null;
  revisit_visit_no: number;
};

const NONE = "__none__";

const emptyForm = (): FormState => ({
  id: null,
  date: new Date().toISOString().slice(0, 10),
  company_id: "",
  leader1_id: "",
  leader2_id: "",
  leader3_id: "",
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
  revisit_required: false,
  revisit_done: false,
  revisit_group_id: null,
  revisit_visit_no: 1,
});

type RecordsColumn = {
  key: string;
  label: string;
  width: number;
  headerCls?: string;
  cellCls?: string;
  render: (r: any, ctx: {
    total: number;
    expanded: boolean;
    toggleExpand: () => void;
    displayLeaderById: (id: string | null | undefined, fallback: string | null | undefined) => string;
    displaySettlementStatus: (r: any) => string;
    removeRow: (id: string) => void;
    selected: boolean;
    toggleSelect: () => void;
  }) => React.ReactNode;
  renderHeader?: (ctx: {
    allSelected: boolean;
    someSelected: boolean;
    toggleAll: (v: boolean) => void;
  }) => React.ReactNode;
};

const RECORDS_EXPECTED_SEQUENCE = [
  ["select", "선택", 44],
  ["kind", "구분", 70],
  ["date", "날짜", 110],
  ["company", "업체", 120],
  ["leader1", "팀장1", 110],
  ["leader2", "팀장2", 110],
  ["leader3", "팀장3", 110],
  ["customer", "고객명", 120],
  ["region", "배송지", 150],
  ["region_type", "지역구분", 100],
  ["item", "품목", 240],
  ["two_person", "2인배송", 100],
  ["note", "비고", 200],
  ["metro_fee", "수도권배송비", 140],
  ["note_amount", "비고금액", 130],
  ["regional_fee", "지방배송비", 140],
  ["cod_amount", "착불", 120],
  ["total", "배송비총액", 140],
  ["split", "분할", 110],
  ["paid", "결제유무", 120],
  ["settle", "정산처리", 260],
  ["delete", "삭제", 60],
] as const;

const RECORDS_AMOUNT_COLUMN_KEYS = new Set(["metro_fee", "note_amount", "regional_fee", "cod_amount", "total"]);
const RECORDS_STATUS_COLUMN_KEYS = new Set(["region_type", "two_person", "split", "paid", "settle"]);
const RECORDS_CENTER_COLUMN_KEYS = new Set([
  "region_type", "item", "note",
  "metro_fee", "note_amount", "regional_fee", "cod_amount", "total",
  "two_person", "split", "paid",
]);

const RECORDS_COLUMNS: RecordsColumn[] = [
  { key: "select", label: "선택", width: 44, headerCls: "text-center", cellCls: "text-center whitespace-nowrap",
    render: (r, { selected, toggleSelect }) => (
      <Checkbox
        checked={selected}
        onCheckedChange={() => toggleSelect()}
        onClick={(e) => e.stopPropagation()}
        aria-label="행 선택"
      />
    ),
    renderHeader: ({ allSelected, someSelected, toggleAll }) => (
      <Checkbox
        checked={allSelected ? true : someSelected ? "indeterminate" as any : false}
        onCheckedChange={(v) => toggleAll(!!v)}
        aria-label="전체 선택"
      />
    ) },
  { key: "kind", label: "구분", width: 70, cellCls: "text-center whitespace-nowrap",
    render: (r) => r.is_missing
      ? <Badge className="bg-orange-500 hover:bg-orange-600">누락분</Badge>
      : <Badge variant="secondary">일반</Badge> },
  { key: "date", label: "날짜", width: 110, cellCls: "whitespace-nowrap",
    render: (r) => r.date },
  { key: "company", label: "업체", width: 120, cellCls: "whitespace-nowrap",
    render: (r) => r.company_name },
  { key: "leader1", label: "팀장1", width: 110, cellCls: "whitespace-nowrap",
    render: (r, { displayLeaderById }) => displayLeaderById(r.leader1_id, r.leader1_name) },
  { key: "leader2", label: "팀장2", width: 110, cellCls: "whitespace-nowrap",
    render: (r, { displayLeaderById }) => displayLeaderById(r.leader2_id, r.leader2_name) },
  { key: "leader3", label: "팀장3", width: 110, cellCls: "whitespace-nowrap",
    render: (r, { displayLeaderById }) => displayLeaderById(r.leader3_id, r.leader3_name) },
  { key: "customer", label: "고객명", width: 120, cellCls: "whitespace-nowrap",
    render: (r) => r.customer_name || "-" },
  { key: "region", label: "배송지", width: 150, cellCls: "whitespace-nowrap",
    render: (r) => r.region || "-" },
  { key: "region_type", label: "지역구분", width: 100, cellCls: "text-center whitespace-nowrap",
    render: (r) => r.region_type === "metro" ? "수도권" : r.region_type === "regional" ? "지방" : "-" },
  { key: "item", label: "품목", width: 240, headerCls: "text-center", cellCls: "align-middle text-center cursor-pointer",
    render: (r, { expanded }) => (
      <div className={`whitespace-pre-wrap break-words text-center ${expanded ? "" : "line-clamp-3"}`}>{r.item || "-"}</div>
    ) },
  { key: "two_person", label: "2인배송", width: 100, cellCls: "text-center whitespace-nowrap font-medium",
    render: (r) => r.two_person ? "2인배송" : "" },
  { key: "note", label: "비고", width: 200, headerCls: "text-center", cellCls: "align-middle text-center",
    render: (r) => <div className="whitespace-pre-wrap break-words text-center">{r.note || "-"}</div> },
  { key: "metro_fee", label: "수도권배송비", width: 140, headerCls: "text-center", cellCls: "text-center whitespace-nowrap tabular-nums",
    render: (r) => fmt(r.metro_fee) },
  { key: "note_amount", label: "비고금액", width: 130, headerCls: "text-center", cellCls: "text-center whitespace-nowrap tabular-nums",
    render: (r) => fmt(r.note_amount) },
  { key: "regional_fee", label: "지방배송비", width: 140, headerCls: "text-center", cellCls: "text-center whitespace-nowrap tabular-nums",
    render: (r) => fmt(r.regional_fee) },
  { key: "cod_amount", label: "착불", width: 120, headerCls: "text-center", cellCls: "text-center whitespace-nowrap tabular-nums",
    render: (r) => fmt(r.cod_amount) },
  { key: "total", label: "배송비총액", width: 140, headerCls: "text-center", cellCls: "text-center whitespace-nowrap tabular-nums font-semibold",
    render: (_r, { total }) => fmt(total) },
  { key: "split", label: "분할", width: 110, cellCls: "text-center whitespace-nowrap",
    render: (r) => r.split_type || "" },
  { key: "paid", label: "결제유무", width: 120, cellCls: "text-center whitespace-nowrap",
    render: (r) => r.paid ? "결제완료" : "미결제" },
  { key: "settle", label: "정산처리", width: 260, cellCls: "text-center text-muted-foreground align-top",
    render: (r, { displaySettlementStatus }) => <div className="whitespace-pre-wrap break-words">{displaySettlementStatus(r)}</div> },
  { key: "delete", label: "삭제", width: 60, cellCls: "text-center whitespace-nowrap",
    render: (r, { removeRow }) => (
      <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); removeRow(r.id); }}>
        <Trash2 className="h-4 w-4" />
      </Button>
    ) },
];

const RECORDS_TABLE_WIDTH = RECORDS_COLUMNS.reduce((sum, c) => sum + c.width, 0);

function validateRecordsTableColumnDefinition(): ValidationIssue[] {
  const mismatches: string[] = [];
  RECORDS_EXPECTED_SEQUENCE.forEach(([key, label, width], i) => {
    const col = RECORDS_COLUMNS[i];
    if (!col) mismatches.push(`#${i + 1} ${label}: 데이터 셀 없음`);
    else if (col.key !== key || col.label !== label || col.width !== width) {
      mismatches.push(`#${i + 1} 예상 ${label}(${key}, ${width}px) / 실제 ${col.label}(${col.key}, ${col.width}px)`);
    }
  });
  if (RECORDS_COLUMNS.length !== RECORDS_EXPECTED_SEQUENCE.length) {
    mismatches.push(`컬럼 수: 헤더 ${RECORDS_EXPECTED_SEQUENCE.length} / 데이터 ${RECORDS_COLUMNS.length}`);
  }
  return mismatches.length === 0 ? [] : [{
    rowId: "__records_table_columns__",
    rowLabel: "테이블 컬럼 위치 검사",
    code: "table.columns.mismatch",
    field: "기록입력 목록",
    severity: "error",
    message: `기록입력 목록의 헤더와 데이터 컬럼 위치가 일치하지 않습니다. ${mismatches.join(" / ")}`,
  }];
}

function RecordsTable({
  records, issuesByRow, expandedItems, setExpandedItems, editRow, removeRow, displayLeaderById, displaySettlementStatus,
  selectedIds, setSelectedIds,
}: {
  records: any[];
  issuesByRow: Map<string, ValidationIssue[]>;
  expandedItems: Record<string, boolean>;
  setExpandedItems: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editRow: (r: any) => void;
  removeRow: (id: string) => void;
  displayLeaderById: (id: string | null | undefined, fallback: string | null | undefined) => string;
  displaySettlementStatus: (r: any) => string;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [alignmentError, setAlignmentError] = useState<string | null>(null);
  const [badCols, setBadCols] = useState<Set<number>>(new Set());
  const [badRowIds, setBadRowIds] = useState<Set<string>>(new Set());
  const [diag, setDiag] = useState<{
    headCount: number;
    expected: number;
    rowCounts: Map<string, number>;
  }>({ headCount: 0, expected: RECORDS_COLUMNS.length, rowCounts: new Map() });
  const [alignLog, setAlignLog] = useState<Array<{
    ts: string;
    headCount: number;
    expected: number;
    entries: Array<{ index: number; expectedLabel: string; actual: string }>;
  }>>([]);
  const [logOpen, setLogOpen] = useState(true);
  const lastLogKeyRef = useRef<string>("");

  useEffect(() => {
    const tbl = tableRef.current;
    if (!tbl) return;
    const headRow = tbl.querySelector("thead tr");
    const bodyRows = tbl.querySelectorAll("tbody tr");
    if (!headRow) return;
    const headCount = headRow.querySelectorAll("th").length;
    const expected = RECORDS_COLUMNS.length;
    const mismatches: string[] = [];
    const badColSet = new Set<number>();
    const badRowSet = new Set<string>();
    const rowCounts = new Map<string, number>();
    if (headCount !== expected) {
      mismatches.push(`헤더 셀 수(${headCount}) ≠ 정의된 컬럼 수(${expected})`);
      // mark every column from divergence point
      for (let i = Math.min(headCount, expected); i < Math.max(headCount, expected); i++) badColSet.add(i);
    }
    bodyRows.forEach((tr, i) => {
      const tdCount = tr.querySelectorAll("td").length;
      // skip placeholder row (uses colSpan)
      const isPlaceholder = tr.querySelector("td[colspan]");
      if (isPlaceholder) return;
      const rid = (tr as HTMLElement).dataset.rowId;
      if (rid) rowCounts.set(rid, tdCount);
      if (tdCount !== headCount) {
        mismatches.push(`${i + 1}행 셀 수(${tdCount}) ≠ 헤더(${headCount})`);
        if (rid) badRowSet.add(rid);
        for (let c = Math.min(tdCount, headCount); c < Math.max(tdCount, headCount); c++) badColSet.add(c);
      }
    });
    setDiag({ headCount, expected, rowCounts });
    if (mismatches.length > 0) {
      const msg = `금액 컬럼 표시 위치가 맞지 않습니다. 헤더와 데이터 셀 순서를 확인하세요. [${mismatches.slice(0, 3).join(" / ")}]`;
      // eslint-disable-next-line no-console
      console.warn("[Records 컬럼 정렬 오류]", msg, {
        headCount, expected, mismatches,
        badColumns: [...badColSet].map((i) => `#${i + 1} ${RECORDS_COLUMNS[i]?.label ?? "(범위초과)"}`),
      });
      if (badColSet.size === 0) RECORDS_COLUMNS.forEach((_c, i) => badColSet.add(i));
      setAlignmentError(msg);
      setBadCols(badColSet);
      setBadRowIds(badRowSet);
      const entries = [...badColSet].sort((a, b) => a - b).map((i) => ({
        index: i + 1,
        expectedLabel: RECORDS_COLUMNS[i]?.label ?? "(범위초과)",
        actual: i < headCount ? `헤더 존재 / 데이터 셀 부족(헤더 ${headCount} vs 데이터 행별 상이)` : `헤더 없음(헤더 ${headCount} < #${i + 1})`,
      }));
      const key = `${headCount}|${expected}|${entries.map((e) => e.index).join(",")}|${badRowSet.size}`;
      if (key !== lastLogKeyRef.current) {
        lastLogKeyRef.current = key;
        setAlignLog((prev) => [
          { ts: new Date().toLocaleTimeString("ko-KR"), headCount, expected, entries },
          ...prev,
        ].slice(0, 50));
      }
    } else {
      setAlignmentError(null);
      setBadCols(new Set());
      setBadRowIds(new Set());
      lastLogKeyRef.current = "";
    }
  }, [records]);

  return (
    <>
      {alignmentError && (
        <div className="p-2 m-2 rounded border border-destructive bg-destructive/10 text-destructive text-xs font-medium">
          ⚠ {alignmentError}
        </div>
      )}
      <Table ref={tableRef} className="text-xs num table-fixed" style={{ width: RECORDS_TABLE_WIDTH, minWidth: RECORDS_TABLE_WIDTH }}>
        <colgroup>
          {RECORDS_COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>
        <TableHeader className="sticky top-0 bg-muted/80 z-10">
          <TableRow>
            {RECORDS_COLUMNS.map((c, i) => (
              <TableHead
                key={c.key}
                className={cn(
                  "whitespace-nowrap px-2 bg-muted/80",
                  RECORDS_AMOUNT_COLUMN_KEYS.has(c.key) && "bg-accent/30",
                  RECORDS_STATUS_COLUMN_KEYS.has(c.key) && "text-center",
                  c.headerCls,
                  badCols.has(i) && "bg-destructive text-destructive-foreground ring-2 ring-destructive",
                )}
                title={
                  badCols.has(i)
                    ? `예상(헤더): #${i + 1} ${c.label}\n실제 헤더 셀 수: ${diag.headCount} / 정의된 컬럼 수: ${diag.expected}\n→ 이 위치에 데이터 셀이 없거나 어긋났습니다.`
                    : undefined
                }
              >
                {c.renderHeader
                  ? c.renderHeader({
                      allSelected: records.length > 0 && records.every((r) => selectedIds.has(r.id)),
                      someSelected: records.some((r) => selectedIds.has(r.id)),
                      toggleAll: (v) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (v) records.forEach((r) => next.add(r.id));
                          else records.forEach((r) => next.delete(r.id));
                          return next;
                        });
                      },
                    })
                  : (badCols.has(i) ? `⚠ ${c.label}` : c.label)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((r) => {
            const total = Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
            const rowIssues = issuesByRow.get(r.id);
            const rowSeverity = rowIssues?.some((i) => i.severity === "error")
              ? "error" : rowIssues?.length ? "warning" : null;
            const isBadRow = badRowIds.has(r.id);
            const ctx = {
              total,
              expanded: !!expandedItems[r.id],
              toggleExpand: () => setExpandedItems((prev) => ({ ...prev, [r.id]: !prev[r.id] })),
              displayLeaderById,
              removeRow,
              displaySettlementStatus,
              selected: selectedIds.has(r.id),
              toggleSelect: () => setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                return next;
              }),
            };
            return (
              <TableRow
                key={r.id}
                data-row-id={r.id}
                className={cn(
                  "cursor-pointer",
                  rowSeverity === "error" && "bg-destructive/5",
                  rowSeverity === "warning" && "bg-orange-500/5",
                  isBadRow && "outline outline-2 outline-destructive",
                )}
                onClick={() => editRow(r)}
              >
                {RECORDS_COLUMNS.map((c, ci) => {
                  const extraProps: React.HTMLAttributes<HTMLTableCellElement> = {};
                  if (c.key === "item") {
                    extraProps.onClick = (e) => { e.stopPropagation(); ctx.toggleExpand(); };
                    (extraProps as any).title = r.item || "";
                  }
                  const highlight = isBadRow && badCols.has(ci);
                  if (highlight) {
                    const actualCount = diag.rowCounts.get(r.id) ?? 0;
                    (extraProps as any).title =
                      `예상(헤더): #${ci + 1} ${c.label}\n실제 데이터 셀 인덱스: #${ci + 1} (행 셀 수 ${actualCount} / 헤더 ${diag.headCount})\n→ 헤더와 데이터 컬럼 순서를 확인하세요.`;
                  }
                  return (
                    <TableCell
                      key={c.key}
                      className={cn("px-2 overflow-hidden", c.cellCls, highlight && "bg-destructive/20 ring-1 ring-destructive")}
                      {...extraProps}
                    >
                      {c.render(r, ctx)}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
          {records.length === 0 && (
            <TableRow>
              <TableCell colSpan={RECORDS_COLUMNS.length} className="text-center py-8 text-muted-foreground">
                기록이 없습니다. 위 새 배송입력 또는 엑셀 붙여넣기로 추가하세요.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {alignLog.length > 0 && (
        <div className="m-2 rounded border border-destructive/40 bg-destructive/5 text-xs">
          <div className="flex items-center justify-between px-3 py-2 border-b border-destructive/30">
            <div className="font-semibold text-destructive">
              정렬 불일치 로그 ({alignLog.length})
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-2 py-0.5 rounded border border-destructive/40 hover:bg-destructive/10"
                onClick={() => setLogOpen((v) => !v)}
              >
                {logOpen ? "접기" : "펼치기"}
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded border border-destructive/40 hover:bg-destructive/10"
                onClick={() => { setAlignLog([]); lastLogKeyRef.current = ""; }}
              >
                지우기
              </button>
            </div>
          </div>
          {logOpen && (
            <div className="max-h-64 overflow-auto divide-y divide-destructive/20">
              {alignLog.map((log, idx) => (
                <div key={idx} className="px-3 py-2">
                  <div className="text-muted-foreground mb-1">
                    [{log.ts}] 헤더 {log.headCount} / 정의 {log.expected}
                  </div>
                  <table className="w-full">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="text-left px-2 py-0.5 font-medium">#</th>
                        <th className="text-left px-2 py-0.5 font-medium">예상 라벨(헤더)</th>
                        <th className="text-left px-2 py-0.5 font-medium">실제(데이터)</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {log.entries.map((e, j) => (
                        <tr key={j}>
                          <td className="px-2 py-0.5 text-destructive font-semibold">#{e.index}</td>
                          <td className="px-2 py-0.5">{e.expectedLabel}</td>
                          <td className="px-2 py-0.5 text-muted-foreground">{e.actual}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// 착불 빠른선택 금액 리스트 (1만 ~ 30만, 1만원 단위)
const COD_AMOUNTS = Array.from({ length: 30 }, (_, i) => (i + 1) * 10000);

// 비고 내용에서 "착불 N만원" 토큰을 제거하거나 새 금액을 덧붙인다.
const COD_NOTE_REGEX = /\s*착불\s*\d+\s*만원/g;
export function applyCodToNote(note: string | null | undefined, codAmount: number): string {
  const cleaned = String(note ?? "").replace(COD_NOTE_REGEX, "").replace(/\s+/g, " ").trim();
  if (!codAmount || codAmount <= 0) return cleaned;
  const man = Math.round(codAmount / 10000);
  const tag = `착불 ${man}만원`;
  return cleaned ? `${cleaned} ${tag}` : tag;
}

function CodPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const cur = parseNum(value) || 0;
  return (
    <div className={cn("grid grid-cols-10 gap-1", className)}>
      {COD_AMOUNTS.map((amt) => {
        const active = cur === amt;
        return (
          <button
            key={amt}
            type="button"
            onClick={() => onChange(active ? "" : String(amt))}
            className={cn(
              "h-8 text-xs rounded border tabular-nums select-none",
              active
                ? "bg-primary text-primary-foreground border-primary font-semibold"
                : "bg-background hover:bg-muted"
            )}
            title={`${amt.toLocaleString()}원`}
          >
            {amt / 10000}만
          </button>
        );
      })}
    </div>
  );
}

export default function Records() {
  const { user } = useAuth();
  const { confirm: confirmSave, dialog: saveConfirmDialog } = useSaveConfirm();
  // 사용자 지정 수도권 키워드 캐시 동기화
  useEffect(() => {
    setMetroKeywordsCache(loadMetroKeywords(user?.id || "anon"));
    const onChange = () => setMetroKeywordsCache(loadMetroKeywords(user?.id || "anon"));
    window.addEventListener("region-keywords-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("region-keywords-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [user?.id]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [records, setRecords] = useState<Delivery[]>([]);
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"bulk" | "form" | "list">("bulk");
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState>(() => {
    try {
      const raw = localStorage.getItem("records.form.draft");
      if (raw) return { ...emptyForm(), ...JSON.parse(raw) } as FormState;
    } catch { /* noop */ }
    return emptyForm();
  });
  const [saving, setSaving] = useState(false);
  // 한 팀장 여러건 일괄 입력
  type BulkRow = {
    company_id: string;
    customer_name: string;
    region: string;
    region_type: RegionType;
    item: string;
    note: string;
    metro_fee: string;
    note_amount: string;
    regional_fee: string;
    cod_amount: string;
    two_person: boolean;
    paid: boolean;
    revisit_required: boolean;
    revisit_done: boolean;
    revisit_group_local: string;
    revisit_visit_no: number;
    revisit_locked?: boolean;
    revisit_group_id_existing?: string;
    revisit_source_id_existing?: string;
    date_existing?: string;
    company_name_existing?: string | null;
    leader1_id_existing?: string | null;
    leader1_name_existing?: string | null;
    leader2_id_existing?: string | null;
    leader2_name_existing?: string | null;
    leader3_id_existing?: string | null;
    leader3_name_existing?: string | null;
    split_type_existing?: string | null;
    paid_existing?: boolean;
    two_person_existing?: boolean;
  };
  const emptyBulkRow = (companyId: string = ""): BulkRow => ({
    company_id: companyId,
    customer_name: "",
    region: "",
    region_type: "unknown",
    item: "",
    note: "",
    metro_fee: "",
    note_amount: "",
    regional_fee: "",
    cod_amount: "",
    two_person: false,
    paid: false,
    revisit_required: false,
    revisit_done: false,
    revisit_group_local: "",
    revisit_visit_no: 1,
  });
  const [bulkOpen, setBulkOpen] = useState(true);
  const [bulkShared, setBulkShared] = useState(() => {
    const def = {
      date: new Date().toISOString().slice(0, 10),
      default_company_id: "",
      leader1_id: "",
      leader2_id: "",
      leader3_id: "",
      two_person: false,
      split_type: "",
      paid: false,
    };
    try {
      const raw = localStorage.getItem("records.bulk.shared.draft");
      if (raw) return { ...def, ...JSON.parse(raw) };
    } catch { /* noop */ }
    return def;
  });
  const [bulkRows, setBulkRows] = useState<BulkRow[]>(() => {
    try {
      const raw = localStorage.getItem("records.bulk.rows.draft");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((r: any) => ({ ...emptyBulkRow(), ...r })) as BulkRow[];
        }
      }
    } catch { /* noop */ }
    return [
      emptyBulkRow(), emptyBulkRow(), emptyBulkRow(),
      emptyBulkRow(), emptyBulkRow(), emptyBulkRow(), emptyBulkRow(),
    ];
  });
  const [bulkSaving, setBulkSaving] = useState(false);
  const bulkCompanyRefs = useRef<Array<HTMLInputElement | null>>([]);
  // 재방문 완료 등록 다이얼로그
  const [revisitPickerOpen, setRevisitPickerOpen] = useState(false);
  const [revisitCandidates, setRevisitCandidates] = useState<any[]>([]);
  const [revisitLoading, setRevisitLoading] = useState(false);
  // 입력 중 동일 고객/지역 자동 감지 다이얼로그
  const [revisitDetectOpen, setRevisitDetectOpen] = useState(false);
  const [revisitDetectIdx, setRevisitDetectIdx] = useState<number | null>(null);
  const [revisitDetectCandidates, setRevisitDetectCandidates] = useState<any[]>([]);
  const [revisitDetectLoading, setRevisitDetectLoading] = useState(false);
  const detectedKeyRef = useRef<Set<string>>(new Set());
  // 같은 고객/배송지 매칭 기준 (사용자 설정, 화면 상단 토글)
  // both: 고객명+지역 모두 일치 / name: 고객명만 / region: 지역만
  const [revisitMatchMode, setRevisitMatchMode] = useState<"both" | "name" | "region">(() => {
    try {
      const v = localStorage.getItem("records.revisitMatchMode");
      if (v === "name" || v === "region" || v === "both") return v;
    } catch { /* noop */ }
    return "both";
  });
  useEffect(() => {
    try { localStorage.setItem("records.revisitMatchMode", revisitMatchMode); } catch { /* noop */ }
    // 기준이 바뀌면 이전에 "검사완료"로 표시된 키 캐시 비움
    detectedKeyRef.current.clear();
  }, [revisitMatchMode]);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [validation, setValidation] = useState<{
    issues: ValidationIssue[];
    summary: ReturnType<typeof summarize>;
    periodChecks: ReturnType<typeof comparePeriodTotals>;
    ranAt: string;
  } | null>(null);
  const [showOnly, setShowOnly] = useState<"all" | "error" | "warning">("all");
  const [searchCompany, setSearchCompany] = useState("");
  const [searchCustomer, setSearchCustomer] = useState("");
  const [searchLeader, setSearchLeader] = useState("");
  const [searchDate, setSearchDate] = useState<Date | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 동(洞) 단독 입력 시 수도권/지방 선택 다이얼로그
  const [dongPrompt, setDongPrompt] = useState<string | null>(null);

  const load = async () => {
    const [{ data: c }, { data: l }, { data: h }] = await Promise.all([
      supabase.from("companies").select("id,name,active,has_cod,rejected_leader_id,rejected_leader_id_2,rejected_leader_id_3").order("name"),
      supabase.from("team_leaders").select("id,name,is_rejected,is_virtual,active,aliases,settle_to_id").order("name"),
      supabase.from("holidays").select("date,scope,team_leader_id,active").eq("active", true),
    ]);
    setCompanies((c as Company[]) || []);
    setLeaders((l as Leader[]) || []);
    setHolidays((h as Holiday[]) || []);
    const start = filterMonth + "-01";
    const next = new Date(filterMonth + "-01"); next.setMonth(next.getMonth() + 1);
    const end = next.toISOString().slice(0, 10);
    const { data: d } = await supabase.from("deliveries").select("*").gte("date", start).lt("date", end).order("date", { ascending: false }).order("created_at", { ascending: false });
    setRecords(d || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterMonth]);

  // 입력 중 내용 자동 저장 (페이지 이동/메뉴 전환 시 보존)
  useEffect(() => {
    try { localStorage.setItem("records.form.draft", JSON.stringify(form)); } catch { /* noop */ }
  }, [form]);
  useEffect(() => {
    try { localStorage.setItem("records.bulk.shared.draft", JSON.stringify(bulkShared)); } catch { /* noop */ }
  }, [bulkShared]);
  useEffect(() => {
    try { localStorage.setItem("records.bulk.rows.draft", JSON.stringify(bulkRows)); } catch { /* noop */ }
  }, [bulkRows]);

  const removeRow = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("deliveries").delete().eq("id", id);
    if (form.id === id) setForm(emptyForm());
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    load();
  };

  const bulkDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { toast.error("선택된 항목이 없습니다."); return; }
    if (!confirm(`선택한 ${ids.length}건을 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from("deliveries").delete().in("id", ids);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    if (form.id && ids.includes(form.id)) setForm(emptyForm());
    setSelectedIds(new Set());
    toast.success(`${ids.length}건 삭제 완료`);
    load();
  };

  const activeCompanies = useMemo(() => companies.filter((c) => c.active), [companies]);
  const companiesById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const formCompany = form.company_id ? companiesById.get(form.company_id) : null;
  const formHasCod = formCompany?.has_cod !== false; // 미등록은 기본 표시

  // 지역구분이 바뀌면 배송비 값을 해당 칸으로 자동 이동 (단일 입력 보장)
  useEffect(() => {
    if (form.region_type === "metro" && form.regional_fee && !form.metro_fee) {
      setForm((f) => ({ ...f, metro_fee: f.regional_fee, regional_fee: "" }));
    } else if (form.region_type === "regional" && form.metro_fee && !form.regional_fee) {
      setForm((f) => ({ ...f, regional_fee: f.metro_fee, metro_fee: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.region_type]);

  // 거부기사도 선택 가능 (저장 시 별칭 적용 — 경고만 표시)
  const selectableLeaders = useMemo(() => leaders.filter((l) => l.active), [leaders]);

  // 표시명: 가능하면 leader_id로 정식 팀장명을 찾아 표시(동명이인 구분 포함).
  // ID가 없거나 매칭 실패면 저장된 원본 이름 사용.
  const leadersById = useMemo(() => new Map(leaders.map((l) => [l.id, l])), [leaders]);

  // 검색 필터 (보기 전용 — 데이터 손상 없음)
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const filteredRecords = useMemo(() => {
    const qc = norm(searchCompany);
    const qcu = norm(searchCustomer);
    const ql = norm(searchLeader);
    const qd = searchDate ? format(searchDate, "yyyy-MM-dd") : "";
    if (!qc && !qcu && !ql && !qd) return records;
    // 팀장 검색은 별칭→정식 매핑 후 비교 (입력값 자체도 부분일치 허용)
    const canonLeader = ql ? norm(canonicalLeaderName(searchLeader, leaders)) : "";
    return records.filter((r: any) => {
      if (qd && r.date !== qd) return false;
      if (qc && !norm(r.company_name).includes(qc)) return false;
      if (qcu && !norm(r.customer_name).includes(qcu)) return false;
      if (ql) {
        const names: string[] = [];
        for (const id of [r.leader1_id, r.leader2_id, r.leader3_id]) {
          if (id) {
            const l = leadersById.get(id);
            if (l) {
              names.push(l.name);
              for (const a of (l.aliases ?? [])) names.push(a);
            }
          }
        }
        if (r.leader1_name) names.push(r.leader1_name);
        if (r.leader2_name) names.push(r.leader2_name);
        if (r.leader3_name) names.push(r.leader3_name);
        const hay = names.map(norm);
        const match = hay.some((h) => h.includes(ql) || (canonLeader && h.includes(canonLeader)));
        if (!match) return false;
      }
      return true;
    });
  }, [records, searchCompany, searchCustomer, searchLeader, searchDate, leaders, leadersById]);

  const displayLeaderById = (id: string | null, fallback: string | null): string => {
    if (id) {
      const l = leadersById.get(id);
      if (l) return getDisplayName(l, leaders);
    }
    return fallback || "-";
  };

  const displaySettlementStatus = (r: Delivery): string => {
    const rowLeaderIds = [r.leader1_id, r.leader2_id, r.leader3_id].filter(Boolean) as string[];
    const redirected = rowLeaderIds
      .map((id) => leadersById.get(id))
      .find((l) => l?.settle_to_id && leadersById.has(l.settle_to_id));
    if (redirected?.settle_to_id) {
      return `${redirected.name} → ${leadersById.get(redirected.settle_to_id)?.name ?? "-"}`;
    }
    if (r.split_type === "형주동석") return "강형주/신동석 반반";
    if (r.split_type === "3분할") return "다른팀장 50%, 강형주 25%, 신동석 25%";
    if (rowLeaderIds.length >= 3) return "3인배송 1/3씩";
    return "일반";
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
      leader3_id: r.leader3_id || "",
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
      revisit_required: !!(r as any).revisit_required,
      revisit_done: !!(r as any).revisit_done,
      revisit_group_id: (r as any).revisit_group_id ?? null,
      revisit_visit_no: Number((r as any).revisit_visit_no ?? 1),
    });
    setFormOpen(true);
    setActiveTab("form");
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
        leader3_id: form.leader3_id || null,
        leader3_name: leaderName(form.leader3_id),
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
    // 팀장2가 입력되면 자동으로 2인배송으로 간주되어 금액이 50/50 분배됨 (확인 다이얼로그 불필요)
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
      leader3_id: form.leader3_id || null,
      leader3_name: leaderName(form.leader3_id),
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
      revisit_required: form.revisit_required,
      revisit_done: form.revisit_done,
      revisit_group_id: form.revisit_group_id,
      revisit_visit_no: form.revisit_visit_no || 1,
    };
    const totalAmt =
      metroN + regionalN +
      (parseNum(form.note_amount) || 0) +
      (parseNum(form.cod_amount) || 0);
    const summary = [
      { label: "구분", value: form.id ? "수정" : "신규 저장" },
      { label: "날짜", value: form.date },
      { label: "업체", value: company.name },
      { label: "고객/지역", value: `${form.customer_name || "-"} / ${form.region || "-"}` },
      { label: "팀장", value: [form.leader1_id, form.leader2_id, form.leader3_id].map(leaderName).filter(Boolean).join("·") || "-" },
      { label: "총액", value: `${fmt(totalAmt)}원` },
      ...(form.revisit_required ? [{ label: "재방문", value: form.revisit_group_id ? "기존 그룹" : "1차+2차 동시 생성" }] : []),
    ];
    const ok = await confirmSave({
      title: form.id ? "수정 확인" : "저장 확인",
      summary,
      confirmLabel: form.id ? "수정" : "저장",
    });
    if (!ok) return;
    setSaving(true);
    let error;
    if (form.id) {
      ({ error } = await supabase.from("deliveries").update(payload).eq("id", form.id));
    } else {
      // 신규 저장 + "재방문 필요" 체크: 1차/2차 두 행을 같은 그룹으로 동시 저장
      if (form.revisit_required && !form.revisit_group_id) {
        const groupId =
          (typeof crypto !== "undefined" && (crypto as any).randomUUID)
            ? (crypto as any).randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const first = { ...payload, revisit_group_id: groupId, revisit_visit_no: 1 };
        const second = { ...payload, revisit_group_id: groupId, revisit_visit_no: 2, revisit_done: false };
        ({ error } = await supabase.from("deliveries").insert([first, second]));
      } else {
        ({ error } = await supabase.from("deliveries").insert(payload));
      }
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

  const bulkSaveAll = async () => {
    if (!user) return;
    if (!bulkShared.date) { toast.error("날짜를 선택하세요"); return; }
    const rows = bulkRows.filter((r) =>
      r.company_id ||
      r.customer_name.trim() ||
      r.region.trim() ||
      r.item.trim() ||
      parseNum(r.metro_fee) ||
      parseNum(r.regional_fee) ||
      parseNum(r.note_amount) ||
      parseNum(r.cod_amount),
    );
    if (rows.length === 0) { toast.error("입력된 행이 없습니다."); return; }
    // 2차(재방문) 행도 팀장이 1차와 달라질 수 있으므로 동일하게 공유 팀장 입력 필요
    if (rows.length > 0 && !bulkShared.leader1_id) { toast.error("팀장1을 선택하세요"); return; }
    const anyTwoPerson = rows.some((r) => r.two_person);
    if (anyTwoPerson && !bulkShared.leader2_id) {
      toast.error("2인배송은 팀장2가 필요합니다.");
      return;
    }
    const missingCompanyIdx = rows.findIndex((r) => !r.company_id);
    if (missingCompanyIdx >= 0) {
      toast.error(`${missingCompanyIdx + 1}번 행의 업체를 선택하세요`);
      return;
    }
    const sourceIds = Array.from(new Set(rows.map((r) => r.revisit_source_id_existing).filter(Boolean) as string[]));
    let sourceById = new Map<string, any>();
    if (sourceIds.length > 0) {
      const { data: sourceRows, error: sourceError } = await supabase
        .from("deliveries")
        .select("*")
        .eq("user_id", user.id)
        .in("id", sourceIds);
      if (sourceError) { toast.error(sourceError.message); return; }
      sourceById = new Map((sourceRows || []).map((r: any) => [r.id, r]));
    }
    const leaderName = (id: string) => leaders.find((l) => l.id === id)?.name || null;
    const makeUuid = () =>
      (typeof crypto !== "undefined" && (crypto as any).randomUUID)
        ? (crypto as any).randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const rowLeaderName = (id?: string | null, savedName?: string | null) => {
      if (id) return leaderName(id) || savedName || null;
      return savedName || null;
    };
    // 로컬 그룹 ID(완료 클릭으로 묶인 1차/2차) → DB 그룹 UUID 매핑
    const groupIdMap = new Map<string, string>();
    // 같은 로컬 그룹 내 최고 차수 — 그 미만은 모두 revisit_done=true
    const maxVisitByGroup = new Map<string, number>();
    for (const r of rows) {
      if (!r.revisit_group_local) continue;
      const v = Number(r.revisit_visit_no) || 1;
      const cur = maxVisitByGroup.get(r.revisit_group_local) ?? 0;
      if (v > cur) maxVisitByGroup.set(r.revisit_group_local, v);
    }
    const payloads = rows.flatMap((r) => {
      const lockedExisting = Boolean(r.revisit_group_id_existing);
      const source = lockedExisting ? sourceById.get(r.revisit_source_id_existing || "") : null;
      const companyId = source?.company_id || r.company_id;
      const co = companies.find((c) => c.id === companyId);
      const base = {
        user_id: user.id,
        date: lockedExisting ? (source?.date || r.date_existing || bulkShared.date) : bulkShared.date,
        company_id: companyId,
        company_name: lockedExisting ? (source?.company_name || r.company_name_existing || co?.name || "") : (co?.name || ""),
        // 2차(재방문)는 팀장이 1차와 달라도 OK — 현재 입력일의 공유 팀장 값을 사용
        leader1_id: bulkShared.leader1_id || null,
      leader1_name: leaderName(bulkShared.leader1_id),
      leader2_id: bulkShared.leader2_id || null,
      leader2_name: leaderName(bulkShared.leader2_id),
      leader3_id: bulkShared.leader3_id || null,
      leader3_name: leaderName(bulkShared.leader3_id),
      customer_name: lockedExisting ? (source?.customer_name || r.customer_name.trim() || null) : (r.customer_name.trim() || null),
      region: lockedExisting ? (source?.region || r.region.trim() || null) : (r.region.trim() || null),
      region_type: lockedExisting ? ((source?.region_type || r.region_type) === "unknown" ? null : (source?.region_type || r.region_type)) : (r.region_type === "unknown" ? null : r.region_type),
      item: lockedExisting ? (source?.item || r.item || null) : (r.item || null),
      note: lockedExisting ? (source?.note || r.note || null) : (r.note || null),
      metro_fee: parseNum(r.metro_fee) || 0,
      note_amount: parseNum(r.note_amount) || 0,
      regional_fee: parseNum(r.regional_fee) || 0,
      cod_amount: parseNum(r.cod_amount) || 0,
      split_type: lockedExisting ? (source?.split_type || r.split_type_existing || null) : (bulkShared.split_type || null),
      paid: lockedExisting ? !!(source?.paid ?? r.paid_existing) : (r.paid || bulkShared.paid),
      two_person: lockedExisting ? !!(source?.two_person ?? r.two_person_existing) : r.two_person,
      is_missing: false,
      // 배열 insert에서 일부 행만 이 필드를 가질 경우 PostgREST가 누락된 행에 NULL을 보내
      // NOT NULL 제약을 위반하므로 모든 행에 기본값을 명시.
      revisit_group_id: null as string | null,
      revisit_visit_no: 1,
      revisit_required: false,
      revisit_done: false,
      };
      // 완료 클릭으로 묶인 1차/2차 행은 그대로 각각 저장 (같은 group_id 공유)
      if (r.revisit_group_local) {
        // 이미 DB에 저장된 1차의 group_id가 있으면 그것을 사용 (저장된 1차에 2차 후속 등록 케이스)
        let gid = groupIdMap.get(r.revisit_group_local);
        if (!gid) {
          gid = r.revisit_group_id_existing || makeUuid();
          groupIdMap.set(r.revisit_group_local, gid);
        }
        const v = Number(r.revisit_visit_no) || 1;
        const maxV = maxVisitByGroup.get(r.revisit_group_local) ?? v;
        return [{
          ...base,
          revisit_group_id: gid,
          revisit_visit_no: v,
          revisit_required: true,
          // 그룹 내 최고 차수 행은 아직 진행 중(done=false), 그 미만은 모두 완료(done=true)
          revisit_done: v < maxV,
        }];
      }
      // 완료 클릭 없이 "예정"만 체크된 경우 → 동일 내용 2차 행 자동 생성
      if (r.revisit_required) {
        const groupId = makeUuid();
        return [
          { ...base, revisit_group_id: groupId, revisit_visit_no: 1, revisit_required: true, revisit_done: false },
          { ...base, revisit_group_id: groupId, revisit_visit_no: 2, revisit_required: true, revisit_done: false },
        ];
      }
      return [base];
    });
    // 요약 다이얼로그
    const totalAmt = payloads.reduce(
      (s, p: any) =>
        s + Number(p.metro_fee || 0) + Number(p.regional_fee || 0) +
        Number(p.note_amount || 0) + Number(p.cod_amount || 0),
      0,
    );
    const companyNames = Array.from(new Set(payloads.map((p: any) => p.company_name).filter(Boolean)));
    const companyLabel = companyNames.length <= 1
      ? (companyNames[0] || "-")
      : `${companyNames[0]} 외 ${companyNames.length - 1}곳`;
    const revisitGroups = new Set(payloads.filter((p: any) => p.revisit_required).map((p: any) => p.revisit_group_id)).size;
    const summary = [
      { label: "저장 건수", value: `${payloads.length}건 (입력 ${rows.length}건)` },
      { label: "날짜", value: bulkShared.date },
      { label: "업체", value: companyLabel },
      { label: "팀장", value: [bulkShared.leader1_id, bulkShared.leader2_id, bulkShared.leader3_id].map(leaderName).filter(Boolean).join("·") || "-" },
      { label: "총액", value: `${fmt(totalAmt)}원` },
      ...(revisitGroups > 0 ? [{ label: "재방문", value: `${revisitGroups}그룹` }] : []),
    ];
    const ok = await confirmSave({ title: "여러건 저장 확인", summary });
    if (!ok) return;
    setBulkSaving(true);
    const { error } = await supabase.from("deliveries").insert(payloads);
    setBulkSaving(false);
    if (error) { toast.error(error.message); return; }
    // 저장된 1차에 2차 후속 등록한 경우 → 해당 1차의 revisit_done=true 로 표시
    const existingGroupIds = Array.from(
      new Set(rows.map((r) => r.revisit_group_id_existing).filter(Boolean) as string[]),
    );
    if (existingGroupIds.length > 0) {
      await supabase
        .from("deliveries")
        .update({ revisit_done: true })
        .in("revisit_group_id", existingGroupIds)
        .eq("revisit_visit_no", 1);
    }
    toast.success(`${rows.length}건 저장 완료`);
    const dc = bulkShared.default_company_id;
    setBulkRows([emptyBulkRow(dc), emptyBulkRow(dc), emptyBulkRow(dc), emptyBulkRow(dc), emptyBulkRow(dc), emptyBulkRow(dc), emptyBulkRow(dc)]);
    load();
  };

  // 미완료 1차 배송 후보 조회 (재방문 완료 등록 다이얼로그)
  const openRevisitPicker = async () => {
    if (!user) return;
    setRevisitPickerOpen(true);
    setRevisitLoading(true);
    const { data, error } = await supabase
      .from("deliveries")
      .select("*")
      .eq("user_id", user.id)
      .eq("revisit_required", true)
      .eq("revisit_visit_no", 1)
      .not("revisit_group_id", "is", null)
      .order("date", { ascending: false })
      .limit(500);
    if (error) { toast.error(error.message); setRevisitLoading(false); return; }
    const all = (data || []) as any[];
    // 같은 group에 visit_no=2 가 이미 있는 그룹은 제외
    const groupIds = all.map((r) => r.revisit_group_id);
    let done = new Set<string>();
    if (groupIds.length > 0) {
      const { data: d2 } = await supabase
        .from("deliveries")
        .select("revisit_group_id")
        .eq("user_id", user.id)
        .eq("revisit_visit_no", 2)
        .in("revisit_group_id", groupIds);
      done = new Set((d2 || []).map((r: any) => r.revisit_group_id));
    }
    setRevisitCandidates(all.filter((r) => !done.has(r.revisit_group_id)));
    setRevisitLoading(false);
  };

  // src 배송 행을 잠금된 2차 BulkRow 로 변환
  const build2ndBulkRowFromSrc = (src: any): BulkRow => {
    const localId =
      (typeof crypto !== "undefined" && (crypto as any).randomUUID)
        ? (crypto as any).randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sourceRegionType =
      (src.region_type as RegionType | null) ||
      (Number(src.regional_fee || 0) > 0 ? "regional" : Number(src.metro_fee || 0) > 0 ? "metro" : classifyRegion(src.region || ""));
    return {
      company_id: src.company_id || "",
      customer_name: src.customer_name || "",
      region: src.region || "",
      region_type: sourceRegionType,
      item: src.item || "",
      note: src.note || "",
      metro_fee: src.metro_fee ? String(src.metro_fee) : "",
      note_amount: src.note_amount ? String(src.note_amount) : "",
      regional_fee: src.regional_fee ? String(src.regional_fee) : "",
      cod_amount: src.cod_amount ? String(src.cod_amount) : "",
      two_person: !!src.two_person,
      paid: !!src.paid,
      revisit_required: true,
      revisit_done: false,
      revisit_group_local: localId,
      revisit_visit_no: 2,
      revisit_locked: true,
      revisit_group_id_existing: src.revisit_group_id,
      revisit_source_id_existing: src.id,
      date_existing: src.date,
      company_name_existing: src.company_name || "",
      leader1_id_existing: src.leader1_id || null,
      leader1_name_existing: src.leader1_name || null,
      leader2_id_existing: src.leader2_id || null,
      leader2_name_existing: src.leader2_name || null,
      leader3_id_existing: src.leader3_id || null,
      leader3_name_existing: src.leader3_name || null,
      split_type_existing: src.split_type || null,
      paid_existing: !!src.paid,
      two_person_existing: !!src.two_person,
    };
  };

  // 후보 선택 → bulk 그리드에 잠금된 2차 행 추가
  const addRevisitFromExisting = (src: any) => {
    setBulkRows((rows) => [...rows, build2ndBulkRowFromSrc(src)]);
    setRevisitPickerOpen(false);
    toast.success(`${src.company_name} ${src.customer_name || ""} 2차 행 추가됨`);
  };

  // 입력 중인 행의 customer/region 으로 과거 배송 매칭 조회
  const detectRevisitForRow = async (idx: number) => {
    const row = bulkRows[idx];
    if (!row || row.revisit_visit_no === 2 || row.revisit_group_local) return;
    const name = (row.customer_name || "").trim();
    const region = (row.region || "").trim();
    // 매칭 기준에 따라 필수 입력값 확인
    if (revisitMatchMode === "name" && !name) return;
    if (revisitMatchMode === "region" && !region) return;
    if (revisitMatchMode === "both" && (!name || !region)) return;
    const key = `${idx}|${revisitMatchMode}|${name.toLowerCase()}|${region.toLowerCase()}`;
    if (detectedKeyRef.current.has(key)) return;
    detectedKeyRef.current.add(key);
    setRevisitDetectLoading(true);
    setRevisitDetectIdx(idx);
    let q = supabase
      .from("deliveries")
      .select("*")
      .order("date", { ascending: false })
      .limit(20);
    if (revisitMatchMode === "name" || revisitMatchMode === "both") {
      if (name) q = q.ilike("customer_name", name);
    }
    if (revisitMatchMode === "region" || revisitMatchMode === "both") {
      if (region) q = q.ilike("region", `%${region}%`);
    }
    const { data, error } = await q;
    setRevisitDetectLoading(false);
    if (error || !data || data.length === 0) { setRevisitDetectIdx(null); return; }
    // 같은 그룹에 1차가 있으면 그것만 후보로, 그룹 없는 단건은 그대로 후보. 항상 "최초 배송"이 보이도록 정리.
    const byGroup = new Map<string, any>();
    const singles: any[] = [];
    for (const r of data) {
      if (r.revisit_group_id) {
        const existing = byGroup.get(r.revisit_group_id);
        // visit_no=1 우선, 없으면 가장 작은 visit_no
        if (!existing || Number(r.revisit_visit_no || 1) < Number(existing.revisit_visit_no || 1)) {
          byGroup.set(r.revisit_group_id, r);
        }
      } else {
        singles.push(r);
      }
    }
    const candidates = [...byGroup.values(), ...singles].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    setRevisitDetectCandidates(candidates);
    setRevisitDetectOpen(true);
  };

  // 감지된 후보 선택 → 항상 그룹의 최초 1차 배송을 가져와 잠금된 다음 차수 행을 자동 생성.
  const confirmDetectedRevisit = async (src: any) => {
    const idx = revisitDetectIdx;
    if (idx == null) return;
    let effectiveSrc = src;
    let nextVisitNo = 2;
    if (src.revisit_group_id) {
      // 그룹 전체 조회 → 최초 1차를 source 로, 다음 차수 번호 계산
      const { data: groupRows } = await supabase
        .from("deliveries")
        .select("*")
        .eq("revisit_group_id", src.revisit_group_id)
        .order("revisit_visit_no", { ascending: true });
      if (groupRows && groupRows.length > 0) {
        const first = groupRows.find((g) => Number(g.revisit_visit_no || 1) === 1) || groupRows[0];
        const maxV = groupRows.reduce((m, g) => Math.max(m, Number(g.revisit_visit_no || 1)), 1);
        effectiveSrc = first;
        nextVisitNo = maxV + 1;
      }
    } else {
      const newGid =
        (typeof crypto !== "undefined" && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const { error } = await supabase
        .from("deliveries")
        .update({
          revisit_group_id: newGid,
          revisit_required: true,
          revisit_done: true,
          revisit_visit_no: 1,
        })
        .eq("id", src.id);
      if (error) { toast.error(`1차 표시 실패: ${error.message}`); return; }
      effectiveSrc = { ...src, revisit_group_id: newGid, revisit_required: true, revisit_done: true, revisit_visit_no: 1 };
    }
    const clone = build2ndBulkRowFromSrc(effectiveSrc);
    clone.revisit_visit_no = nextVisitNo;
    // 현재 입력 행은 그대로 두고, 바로 아래에 잠금된 2차 행(원본 1차 내용 그대로, 금액만 수정 가능)을 자동 생성.
    // 팀장이 1차와 달라도 _existing 필드에 보관되어 함께 표시됨.
    setBulkRows((rows) => {
      const next = [...rows];
      next.splice(idx + 1, 0, clone);
      return next;
    });
    setRevisitDetectOpen(false);
    setRevisitDetectCandidates([]);
    setRevisitDetectIdx(null);
    toast.success(`${effectiveSrc.company_name} ${effectiveSrc.customer_name || ""} ${nextVisitNo}차 행이 아래에 추가됨 (최초 1차 내용 그대로, 금액만 수정 가능)`);
  };

  // 종합 오류 검사 실행
  const runValidation = () => {
    const ctx: ValidationContext = {
      companies: companies.map((c) => ({ id: c.id, name: c.name })),
      leaders: leaders.map((l) => ({
        id: l.id, name: l.name, is_rejected: l.is_rejected,
        is_virtual: l.is_virtual, active: l.active, aliases: l.aliases ?? [],
        settle_to_id: (l as any).settle_to_id ?? null,
      })),
      holidays: holidays.map((h) => ({
        date: h.date, scope: h.scope as any, team_leader_id: h.team_leader_id,
      })),
      classifyRegion,
    };
    const recs = records as ValRecord[];
    const issues = [
      ...validateAll(recs, ctx, (r) => `${r.date || "?"} ${r.company_name || ""} ${r.customer_name || ""}`),
      ...validateRecordsTableColumnDefinition(),
    ];
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
  const recordsRootRef = useRef<HTMLDivElement>(null);
  useArrowKeyNav(recordsRootRef);

  return (
    <div className="space-y-4" ref={recordsRootRef}>
      {saveConfirmDialog}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold flex-1 min-w-full sm:min-w-0 whitespace-nowrap">기록입력</h1>
        <Input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className="w-40 flex-1 sm:flex-none" />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-40 justify-start text-left font-normal shrink-0",
                !searchDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {searchDate ? format(searchDate, "yyyy-MM-dd") : "날짜 선택"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={searchDate}
              onSelect={(d) => setSearchDate(d)}
              defaultMonth={searchDate ?? new Date(filterMonth + "-01")}
              initialFocus
              locale={ko}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        {searchDate && (
          <Button variant="ghost" size="sm" onClick={() => setSearchDate(undefined)} className="shrink-0">
            <X className="h-4 w-4 mr-1" />날짜 초기화
          </Button>
        )}
        <Button onClick={() => setPasteOpen(true)} className="shrink-0"><ClipboardPaste className="h-4 w-4 mr-1" />엑셀 붙여넣기</Button>
        <div className="flex-1" />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "bulk" | "form" | "list")} className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full md:w-auto md:inline-grid">
          <TabsTrigger value="bulk">배송 입력</TabsTrigger>
          <TabsTrigger value="form" onClick={() => { if (activeTab !== "form") setForm(emptyForm()); }}>1건 배송 입력</TabsTrigger>
          <TabsTrigger value="list">배송내역 상세 <Badge variant="secondary" className="ml-2">{records.length}</Badge></TabsTrigger>
        </TabsList>

      <TabsContent value="bulk" className="mt-0">
        <Card className="p-4 md:p-6 space-y-4 border-primary/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold border-l-4 border-primary pl-2">한 팀장 여러건 배송입력</h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">재방문 매칭 기준:</span>
              <div className="inline-flex rounded-md border overflow-hidden">
                {([
                  { v: "both", label: "고객명 + 지역" },
                  { v: "name", label: "고객명만" },
                  { v: "region", label: "지역만" },
                ] as const).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setRevisitMatchMode(opt.v)}
                    className={cn(
                      "px-2.5 py-1 text-xs",
                      revisitMatchMode === opt.v
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    )}
                    title={`${opt.label} 일치 시 재방문 후보로 검색`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>날짜</Label>
              <div className="flex gap-1">
                <Input
                  type="date"
                  value={bulkShared.date}
                  onChange={(e) => setBulkShared({ ...bulkShared, date: e.target.value })}
                  className="flex-1"
                />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="icon" type="button" title="달력">
                      <CalendarIcon className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={bulkShared.date ? new Date(bulkShared.date + "T00:00:00") : undefined}
                      onSelect={(d) => d && setBulkShared({ ...bulkShared, date: format(d, "yyyy-MM-dd") })}
                      locale={ko}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {[
                  { label: "오늘", offset: 0 },
                  { label: "어제", offset: -1 },
                  { label: "그저께", offset: -2 },
                ].map((q) => {
                  const d = new Date();
                  d.setDate(d.getDate() + q.offset);
                  const iso = format(d, "yyyy-MM-dd");
                  const active = bulkShared.date === iso;
                  return (
                    <Button
                      key={q.label}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setBulkShared({ ...bulkShared, date: iso })}
                    >
                      {q.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <Label>기본 업체 (신규 행에 자동 적용)</Label>
              <CompanyCombobox
                companies={activeCompanies.map((c) => ({ id: c.id, name: c.name }))}
                value={bulkShared.default_company_id}
                onChange={(v) => setBulkShared({ ...bulkShared, default_company_id: v })}
                placeholder="(선택) 행마다 다르면 비워두세요"
              />
            </div>
            {[1, 2, 3].map((i) => {
              const key = (`leader${i}_id`) as "leader1_id" | "leader2_id" | "leader3_id";
              return (
                <div key={i} className="space-y-1">
                  <Label>팀장{i}{i === 1 ? " *" : ""}</Label>
                  <LeaderCombobox
                    leaders={selectableLeaders}
                    value={bulkShared[key] || ""}
                    onChange={(v) => {
                      const nextShared = { ...bulkShared, [key]: v };
                      setBulkShared(nextShared);
                    }}
                    placeholder="팀장명 입력 (부분검색·↑↓ 선택)"
                  />
                </div>
              );
            })}
            <div className="space-y-1">
              <Label>분할</Label>
              <Select
                value={bulkShared.split_type || "__none__"}
                onValueChange={(v) => setBulkShared({ ...bulkShared, split_type: v === "__none__" ? "" : v })}
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
              <div
                role="button"
                tabIndex={0}
                onClick={() => setBulkShared((s) => ({ ...s, paid: !s.paid }))}
                className="flex items-center gap-2 h-10 px-3 border rounded-md cursor-pointer select-none"
              >
                <Checkbox checked={bulkShared.paid} tabIndex={-1} className="pointer-events-none" />
                <span>{bulkShared.paid ? "결제완료" : "미결제"}</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr className="text-left">
                  <th className="p-2 w-8">#</th>
                  <th className="p-2 min-w-[140px]">업체 *</th>
                  <th className="p-2 min-w-[110px]">고객명</th>
                  <th className="p-2 min-w-[140px]">배송지</th>
                  <th className="p-2 min-w-[180px]">품목</th>
                  <th className="p-2 min-w-[100px]">2인배송</th>
                  <th className="p-2 min-w-[120px]">비고</th>
                  <th className="p-2 min-w-[120px]">배송비</th>
                  <th className="p-2 min-w-[100px]">비고금액</th>
                  <th className="p-2 min-w-[120px]">착불</th>
                  <th className="p-2 min-w-[90px]">선결제</th>
                  <th className="p-2 min-w-[100px]">지역구분</th>
                  <th className="p-2 min-w-[90px]">재방문요청</th>
                  <th className="p-2 min-w-[90px]">재방문진행</th>
                  <th className="p-2 min-w-[100px]">총액</th>
                  <th className="p-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((r, idx) => {
                  const total = (parseNum(r.metro_fee) || 0) + (parseNum(r.note_amount) || 0) + (parseNum(r.regional_fee) || 0) + (parseNum(r.cod_amount) || 0);
                  const upd = (patch: Partial<BulkRow>) =>
                    setBulkRows((rows) => rows.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                  // isFollowup = "잠금된 이전 차수 행" (내용 전체 잠금, 비고금액만 수정 가능)
                  // 활성 입력 행은 항상 현재 작성 중인 최신 차수 (revisit_locked=false)
                  const isFollowup = !!r.revisit_locked;
                  const visitNo = Number(r.revisit_visit_no) || 1;
                  return (
                     <tr
                       key={idx}
                       className={cn("border-t", isFollowup && "bg-muted/30")}
                       onKeyDown={(e) => {
                         if (e.key !== "Enter") return;
                         if (e.defaultPrevented) return;
                         const target = e.target as HTMLElement;
                         // Select/Combobox 등이 자체 처리하는 경우는 제외
                         if (target.tagName === "BUTTON" || target.getAttribute("role") === "combobox") return;
                         e.preventDefault();
                         const nextIdx = idx + 1;
                         const focusNext = () => {
                           const el = bulkCompanyRefs.current[nextIdx];
                           if (el) { el.focus(); el.select?.(); }
                         };
                         if (nextIdx >= bulkRows.length) {
                           setBulkRows((rows) => [...rows, emptyBulkRow(bulkShared.default_company_id)]);
                           setTimeout(focusNext, 0);
                         } else {
                           focusNext();
                         }
                       }}
                     >
                      <td className="p-1 text-center text-muted-foreground whitespace-nowrap">
                        <div className="flex flex-col items-center gap-0.5">
                          <span>{idx + 1}</span>
                          {r.revisit_group_local && (
                            <>
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded font-semibold",
                                isFollowup ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground"
                              )}>
                                {`${visitNo}차배송`}
                              </span>
                              {isFollowup && r.date_existing && (
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="최초 재방문 요청 1차 배송일">
                                  1차: {r.date_existing}
                                </span>
                              )}
                              {isFollowup && (r.leader1_name_existing || r.leader2_name_existing || r.leader3_name_existing) && (
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="최초 1차 배송 팀장">
                                  1차 팀장: {[r.leader1_name_existing, r.leader2_name_existing, r.leader3_name_existing].filter(Boolean).join("·")}
                                </span>
                              )}
                              <button
                                type="button"
                                className="text-[10px] px-1.5 py-0.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                                title="재방문 그룹을 해제하고 후속 차수 행을 모두 제거합니다"
                                onClick={() => {
                                  const gid = r.revisit_group_local;
                                  if (!gid) return;
                                  setBulkRows((rows) => {
                                    // 같은 로컬 그룹의 잠금 행(이전 차수) 모두 제거, 활성 행은 재방문 표시 해제 후 1차로 되돌림
                                    const filtered = rows.filter((x) => !(x.revisit_group_local === gid && x.revisit_locked));
                                    return filtered.map((x) => {
                                      if (x.revisit_group_local !== gid) return x;
                                      const { revisit_group_local, revisit_group_id_existing, revisit_source_id_existing,
                                        date_existing, company_name_existing,
                                        leader1_id_existing, leader1_name_existing,
                                        leader2_id_existing, leader2_name_existing,
                                        leader3_id_existing, leader3_name_existing,
                                        split_type_existing, paid_existing, two_person_existing,
                                        ...rest } = x as any;
                                      return { ...rest, revisit_required: false, revisit_done: false, revisit_visit_no: 1 } as BulkRow;
                                    });
                                  });
                                  toast.success("재방문 해제됨");
                                }}
                              >
                                취소
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-1">
                        {isFollowup ? (
                          <Input
                            className="h-8"
                             value={r.company_name_existing || companiesById.get(r.company_id)?.name || ""}
                            disabled
                            readOnly
                          />
                        ) : (
                        <CompanyCombobox
                          companies={activeCompanies.map((c) => ({ id: c.id, name: c.name }))}
                          value={r.company_id}
                          onChange={(v) => {
                            const newCompany = v ? companiesById.get(v) : null;
                            const patch: Partial<BulkRow> = { company_id: v };
                            if (newCompany && newCompany.has_cod === false) patch.cod_amount = "";
                            upd(patch);
                          }}
                          placeholder="업체"
                          inputRef={(el) => { bulkCompanyRefs.current[idx] = el; }}
                        />
                        )}
                      </td>
                      <td className="p-1"><Input className="h-8" value={r.customer_name} onChange={(e) => upd({ customer_name: e.target.value })} onBlur={() => detectRevisitForRow(idx)} disabled={isFollowup} /></td>
                      <td className="p-1">
                        <Input
                          className="h-8"
                          value={r.region}
                          disabled={isFollowup}
                          onBlur={() => detectRevisitForRow(idx)}
                          onChange={(e) => {
                            const v = e.target.value;
                            const next = classifyRegion(v);
                            const fee = r.metro_fee || r.regional_fee || "";
                            const patch: Partial<BulkRow> = { region: v, region_type: next, metro_fee: "", regional_fee: "" };
                            if (next === "metro") patch.metro_fee = fee;
                            else if (next === "regional") patch.regional_fee = fee;
                            else { patch.metro_fee = r.metro_fee; patch.regional_fee = r.regional_fee; }
                            upd(patch);
                          }}
                        />
                      </td>
                      <td className="p-1"><Input className="h-8" value={r.item} onChange={(e) => upd({ item: e.target.value })} disabled={isFollowup} /></td>
                      <td className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => { if (!isFollowup) upd({ two_person: !r.two_person }); }}
                          disabled={isFollowup}
                          className={cn(
                            "inline-flex items-center justify-center h-8 w-full px-2 rounded-md border text-xs font-medium select-none",
                            r.two_person ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground",
                            isFollowup && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {r.two_person ? "2인배송" : "—"}
                        </button>
                      </td>
                       <td className="p-1"><Input className="h-8" value={r.note} onChange={(e) => upd({ note: e.target.value })} disabled={isFollowup} /></td>
                      <td className="p-1">
                        <AmountTextInput
                          className={cn(
                            "h-8 text-right tabular-nums",
                            r.region_type === "unknown" && "border-destructive"
                          )}
                          value={r.region_type === "regional" ? r.regional_fee : r.metro_fee}
                          onChange={(v) => {
                            if (r.region_type === "regional") upd({ regional_fee: v, metro_fee: "" });
                            else upd({ metro_fee: v, regional_fee: "" });
                          }}
                          disabled={!isFollowup && r.region_type === "unknown"}
                          placeholder={r.region_type === "unknown" ? (isFollowup ? "금액 입력" : "지역 먼저") : ""}
                        />
                      </td>
                      <td className="p-1"><AmountTextInput className="h-8 text-right tabular-nums" value={r.note_amount} onChange={(v) => upd({ note_amount: v })} /></td>
                      <td className="p-1">
                        {(() => {
                          const rowCompany = r.company_id ? companiesById.get(r.company_id) : null;
                          const rowHasCod = rowCompany?.has_cod !== false;
                          if (!rowHasCod) {
                            return <div className="h-8 flex items-center justify-center text-[11px] text-muted-foreground">착불 미지원</div>;
                          }
                          const cur = parseNum(r.cod_amount) || 0;
                          return (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  disabled={isFollowup}
                                  className={cn(
                                    "h-8 w-full rounded-md border text-xs tabular-nums px-2",
                                    cur > 0 ? "bg-primary/10 border-primary font-semibold" : "bg-background text-muted-foreground",
                                    isFollowup && "opacity-50 cursor-not-allowed"
                                  )}
                                >
                                  {cur > 0 ? `${cur.toLocaleString()}원` : "착불 선택"}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[420px] p-3" align="start">
                                <div className="space-y-2">
                                  <div className="text-xs text-muted-foreground">착불 금액 선택 (1만~30만)</div>
                                  <CodPicker
                                    value={r.cod_amount}
                                    onChange={(v) => {
                                      const amt = parseNum(v) || 0;
                                      upd(isFollowup ? { cod_amount: v } : { cod_amount: v, note: applyCodToNote(r.note, amt) });
                                    }}
                                  />
                                  <div className="flex items-center gap-2">
                                    <Label className="text-xs">직접 입력</Label>
                                    <AmountTextInput
                                      className="h-8 text-right tabular-nums flex-1"
                                      value={r.cod_amount}
                                      onChange={(v) => {
                                        const amt = parseNum(v) || 0;
                                        upd(isFollowup ? { cod_amount: v } : { cod_amount: v, note: applyCodToNote(r.note, amt) });
                                      }}
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => upd(isFollowup ? { cod_amount: "" } : { cod_amount: "", note: applyCodToNote(r.note, 0) })}
                                    >
                                      삭제
                                    </Button>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          );
                        })()}
                      </td>
                      <td className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => { if (!isFollowup) upd({ paid: !r.paid }); }}
                          disabled={isFollowup}
                          className={cn(
                            "inline-flex items-center justify-center h-8 w-full px-2 rounded-md border text-xs font-medium select-none",
                            r.paid ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground",
                            isFollowup && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {r.paid ? "선결제" : "—"}
                        </button>
                      </td>
                      <td className="p-1">
                        <Select
                          value={r.region_type}
                          disabled={isFollowup}
                          onValueChange={(v) => {
                            const next = v as RegionType;
                            // 배송비 값을 새 지역구분 칸으로 자동 이동
                            const fee = r.metro_fee || r.regional_fee || "";
                            const patch: Partial<BulkRow> = { region_type: next, metro_fee: "", regional_fee: "" };
                            if (next === "metro") patch.metro_fee = fee;
                            else if (next === "regional") patch.regional_fee = fee;
                            upd(patch);
                          }}
                        >
                          <SelectTrigger className={cn("h-8", r.region_type === "unknown" && "border-destructive text-destructive")}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="metro">수도권</SelectItem>
                            <SelectItem value="regional">지방</SelectItem>
                            <SelectItem value="unknown">미분류</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1 text-center">
                        <button
                          type="button"
                         onClick={() => {
                           if (isFollowup) return;
                           const next = !r.revisit_required;
                           upd({ revisit_required: next });
                           // 재방문 체크 시 → 같은 고객/지역의 과거 원본 배송을 즉시 검색해 보여줌
                           if (next) {
                             detectedKeyRef.current.clear();
                             detectRevisitForRow(idx);
                           }
                         }}
                          disabled={isFollowup}
                          className={cn(
                            "inline-flex items-center justify-center h-8 w-full px-2 rounded-md border text-xs font-medium select-none",
                            r.revisit_required ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground",
                            isFollowup && "opacity-50 cursor-not-allowed"
                          )}
                          title="저장 시 같은 내용의 2차 방문 행이 함께 생성됩니다 (업체 청구는 1건으로 합산)"
                        >
                           {isFollowup ? `${visitNo}차` : (r.revisit_required ? "요청" : "—")}
                        </button>
                      </td>
                      <td className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            // 재방문 진행 클릭 시:
                            // - 현재 행은 그대로 N차배송(예: 1차배송)으로 유지됨.
                            // - 바로 아래에 같은 내용의 다음 차수(N+1) "잠금 복제본"이 자동 생성됨.
                            //   복제본은 금액/비고만 수정 가능, 나머지는 모두 잠김.
                            // 활성 행이 이미 잠금 행이어도 그 위에 새 차수를 더 만들 수 있어야 하므로 허용.
                            setBulkRows((rows) => {
                              const next = [...rows];
                              const cur = rows[idx];
                              const curVisitNo = Number(cur.revisit_visit_no) || 1;
                              const nextVisitNo = curVisitNo + 1;
                              const groupLocal = cur.revisit_group_local || (
                                (typeof crypto !== "undefined" && (crypto as any).randomUUID)
                                  ? (crypto as any).randomUUID()
                                  : `${Date.now()}-${Math.random().toString(16).slice(2)}`
                              );
                              // 현재 행: 1차(또는 현재 차수)로 그대로 유지. 그룹/요청 표시만 보장.
                              next[idx] = {
                                ...cur,
                                revisit_required: true,
                                revisit_group_local: groupLocal,
                                revisit_visit_no: curVisitNo,
                              };
                              // 바로 아래: 다음 차수의 잠금 복제본 (내용 자동 생성, 금액/비고만 수정 가능)
                              const nextLocked: BulkRow = {
                                ...cur,
                                revisit_required: true,
                                revisit_done: false,
                                revisit_group_local: groupLocal,
                                revisit_visit_no: nextVisitNo,
                                revisit_locked: true,
                              };
                              next.splice(idx + 1, 0, nextLocked);
                              return next;
                            });
                          }}
                          disabled={false}
                          className={cn(
                            "inline-flex items-center justify-center h-8 w-full px-2 rounded-md border text-xs font-medium select-none",
                            r.revisit_done ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground"
                          )}
                          title="클릭 시 같은 내용의 다음 차수 행이 바로 아래에 복제 생성됩니다 (2차·3차·… 무제한 체이닝)"
                        >
                          {r.revisit_done ? "완료" : `+${visitNo + 1}차`}
                        </button>
                      </td>
                      <td className="p-1 text-right font-semibold">{fmt(total)}</td>
                      <td className="p-1 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setBulkRows((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx)))}
                          disabled={bulkRows.length <= 1}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/50 font-semibold">
                <tr className="border-t">
                  <td className="p-2 text-right" colSpan={7}>합계</td>
                  <td className="p-2 text-right">
                    {fmt(bulkRows.reduce((s, r) => s + (parseNum(r.metro_fee) || 0) + (parseNum(r.regional_fee) || 0), 0))}
                  </td>
                  <td className="p-2 text-right">
                    {fmt(bulkRows.reduce((s, r) => s + (parseNum(r.note_amount) || 0), 0))}
                  </td>
                  <td className="p-2 text-right">
                    {fmt(bulkRows.reduce((s, r) => s + (parseNum(r.cod_amount) || 0), 0))}
                  </td>
                  <td colSpan={4} />
                  <td className="p-2 text-right">
                    {fmt(bulkRows.reduce(
                      (s, r) => s + (parseNum(r.metro_fee) || 0) + (parseNum(r.note_amount) || 0) + (parseNum(r.regional_fee) || 0) + (parseNum(r.cod_amount) || 0),
                      0,
                    ))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setBulkRows((rows) => [...rows, emptyBulkRow(bulkShared.default_company_id)])}>
              <Plus className="h-4 w-4 mr-1" /> 행 추가
            </Button>
            <Button variant="outline" onClick={() => setBulkRows((rows) => [...rows, ...Array.from({ length: 5 }, () => emptyBulkRow(bulkShared.default_company_id))])}>
              <Plus className="h-4 w-4 mr-1" /> 5행 추가
            </Button>
            <Button variant="secondary" onClick={openRevisitPicker} title="이미 저장된 1차 배송을 골라 2차 행을 자동 생성합니다">
              재방문 완료 등록 (저장된 1차 가져오기)
            </Button>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">총 {bulkRows.length}행</span>
            <Button size="lg" onClick={bulkSaveAll} disabled={bulkSaving}>
              {bulkSaving ? "저장 중…" : "모두 저장"}
            </Button>
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="form" className="mt-0">
        <Card className="p-4 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {form.id ? "배송 수정" : (form.is_missing ? "누락분 추가" : "새 배송 입력")}
              {form.is_missing && <Badge className="bg-orange-500 hover:bg-orange-600">누락분</Badge>}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => { setForm(emptyForm()); }}>
              <X className="h-4 w-4 mr-1" />초기화
            </Button>
          </div>

          <div className={`form-cells ${form.id ? "is-edit" : "is-new"} grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`}>
            <div className="space-y-1">
              <Label>날짜</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-full justify-start text-left font-normal", !form.date && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {form.date ? format(new Date(form.date + "T00:00:00"), "yyyy-MM-dd") : "날짜 선택"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={form.date ? new Date(form.date + "T00:00:00") : undefined}
                    onSelect={(d) => d && setForm({ ...form, date: format(d, "yyyy-MM-dd") })}
                    locale={ko}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap gap-1 pt-1">
                {[
                  { label: "오늘", offset: 0 },
                  { label: "어제", offset: -1 },
                  { label: "그저께", offset: -2 },
                ].map((q) => {
                  const d = new Date();
                  d.setDate(d.getDate() + q.offset);
                  const iso = format(d, "yyyy-MM-dd");
                  const active = form.date === iso;
                  return (
                    <Button
                      key={q.label}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setForm({ ...form, date: iso })}
                    >
                      {q.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <Label>업체</Label>
              <CompanyCombobox
                companies={activeCompanies.map((c) => ({ id: c.id, name: c.name }))}
                value={form.company_id}
                onChange={(v) => {
                  const newCompany = v ? companiesById.get(v) : null;
                  setForm((f) => ({
                    ...f,
                    company_id: v,
                    cod_amount: newCompany && newCompany.has_cod === false ? "" : f.cod_amount,
                  }));
                }}
                placeholder="업체명 입력 (부분검색·↑↓ 선택)"
              />
            </div>

            {[0, 1, 2].map((i) => {
              const key = (`leader${i + 1}_id`) as "leader1_id" | "leader2_id" | "leader3_id";
              const selCompany = companies.find((c) => c.id === form.company_id);
              const rejectedIds = selCompany
                ? [selCompany.rejected_leader_id, selCompany.rejected_leader_id_2, selCompany.rejected_leader_id_3].filter(Boolean) as string[]
                : [];
              const isCompanyRejected = !!form[key] && rejectedIds.includes(form[key]);
              return (
                <div key={i} className="space-y-1">
                  <Label>팀장{i + 1}</Label>
                  <LeaderCombobox
                    leaders={selectableLeaders}
                    value={form[key] || ""}
                    onChange={(v) => {
                      setForm({ ...form, [key]: v });
                    }}
                    placeholder="팀장명 입력 (부분검색·↑↓ 선택)"
                  />
                  {isCompanyRejected && (
                    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      해당 업체는 선택한 팀장을 거부팀장으로 등록한 업체입니다. (거부기사 표시 적용)
                    </div>
                  )}
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
                onBlur={(e) => {
                  const v = (e.target.value || "").trim();
                  if (!v) return;
                  // "동" 단독 입력이며 키워드에 미등록 → 사용자 선택 요청
                  if (isDongOnly(v) && classifyRegion(v) !== "metro") {
                    setDongPrompt(v);
                  }
                }}
              />
              {form.region && isDongOnly(form.region.trim()) && classifyRegion(form.region.trim()) !== "metro" && (
                <div className="text-[11px] text-amber-700">
                  '{form.region.trim()}'은(는) 동 이름만 입력되어 자동 분류가 어렵습니다. 수도권/지방을 선택하세요.
                </div>
              )}
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

            <div className="space-y-1 sm:col-span-2 lg:col-span-4">
              <Label>
                착불 선택
                <span className="ml-2 text-xs text-muted-foreground">
                  (클릭해서 금액 선택 · 비고에 "착불 N만원" 자동 입력 · 1만~30만)
                </span>
              </Label>
              {formHasCod ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "h-10 w-full rounded-md border px-3 text-sm tabular-nums text-left",
                        (parseNum(form.cod_amount) || 0) > 0
                          ? "bg-primary/10 border-primary font-semibold"
                          : "bg-background text-muted-foreground",
                      )}
                    >
                      {(parseNum(form.cod_amount) || 0) > 0
                        ? `착불 ${(parseNum(form.cod_amount) || 0).toLocaleString()}원`
                        : "착불 선택 (클릭)"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[420px] p-3" align="start">
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">착불 금액 선택 (1만~30만)</div>
                      <CodPicker
                        value={form.cod_amount}
                        onChange={(v) => {
                          const amt = parseNum(v) || 0;
                          setForm({ ...form, cod_amount: v, note: applyCodToNote(form.note, amt) });
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">직접 입력</Label>
                        <AmountTextInput
                          className="h-8 text-right tabular-nums flex-1"
                          value={form.cod_amount}
                          onChange={(v) => {
                            const amt = parseNum(v) || 0;
                            setForm({ ...form, cod_amount: v, note: applyCodToNote(form.note, amt) });
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setForm({ ...form, cod_amount: "", note: applyCodToNote(form.note, 0) })
                          }
                        >
                          삭제
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <div className="text-[11px] text-muted-foreground">착불 미지원 업체</div>
              )}
            </div>

            <div className="space-y-1">
              <Label>
                배송비
                {form.region_type === "metro" && <span className="ml-1 text-xs text-muted-foreground">(수도권)</span>}
                {form.region_type === "regional" && <span className="ml-1 text-xs text-muted-foreground">(지방)</span>}
              </Label>
              <AmountTextInput
                className="text-right tabular-nums"
                value={form.region_type === "regional" ? form.regional_fee : form.metro_fee}
                onChange={(v) => {
                  if (form.region_type === "regional") {
                    setForm({ ...form, regional_fee: v, metro_fee: "" });
                  } else if (form.region_type === "metro") {
                    setForm({ ...form, metro_fee: v, regional_fee: "" });
                  } else {
                    // 지역구분 미선택 — 임시로 수도권 칸에 저장. UI에서 경고 표시.
                    setForm({ ...form, metro_fee: v, regional_fee: "" });
                  }
                }}
                disabled={form.region_type === "unknown"}
              />
              {form.region_type === "unknown" && (
                <div className="text-[11px] text-destructive">지역구분을 먼저 선택하세요 (수도권/지방).</div>
              )}
            </div>
            <div className="space-y-1">
              <Label>비고금액</Label>
              <AmountTextInput className="text-right tabular-nums" value={form.note_amount} onChange={(v) => setForm({ ...form, note_amount: v })} />
            </div>
            <div className="space-y-1">
              <Label>착불 금액</Label>
              {formHasCod ? (
                <AmountTextInput
                  className="text-right tabular-nums"
                  value={form.cod_amount}
                  onChange={(v) => {
                    const amt = parseNum(v) || 0;
                    setForm({ ...form, cod_amount: v, note: applyCodToNote(form.note, amt) });
                  }}
                />
              ) : (
                <Input value="착불 미지원 업체" disabled className="bg-muted text-muted-foreground" />
              )}
            </div>

            <div className="space-y-1">
              <Label>배송비총액 (자동)</Label>
              <Input value={fmt(total)} readOnly className="bg-muted font-semibold" />
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
              <div
                role="button"
                tabIndex={0}
                onClick={() => setForm((f) => ({ ...f, paid: !f.paid }))}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setForm((f) => ({ ...f, paid: !f.paid }));
                  }
                }}
                className="flex items-center gap-2 h-10 px-3 border rounded-md cursor-pointer select-none"
              >
                <Checkbox checked={form.paid} tabIndex={-1} className="pointer-events-none" />
                <span>{form.paid ? "결제완료" : "미결제"}</span>
              </div>
            </div>
            <div className="space-y-1 flex flex-col">
              <Label>재방문요청</Label>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setForm((f) => ({ ...f, revisit_required: !f.revisit_required }))}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setForm((f) => ({ ...f, revisit_required: !f.revisit_required }));
                  }
                }}
                className="flex items-center gap-2 h-10 px-3 border rounded-md cursor-pointer select-none"
                title="신규 저장 시 같은 내용의 2차 방문 행이 바로 아래에 자동 생성됩니다 (업체 청구는 1건으로 합산)"
              >
                <Checkbox checked={form.revisit_required} tabIndex={-1} className="pointer-events-none" />
                <span>{form.revisit_required ? "재방문 요청됨" : "—"}</span>
              </div>
            </div>
            <div className="space-y-1 flex flex-col">
              <Label>재방문 진행</Label>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setForm((f) => ({ ...f, revisit_done: !f.revisit_done }))}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    setForm((f) => ({ ...f, revisit_done: !f.revisit_done }));
                  }
                }}
                className="flex items-center gap-2 h-10 px-3 border rounded-md cursor-pointer select-none"
                title="실제 재방문이 완료되었는지 표시"
              >
                <Checkbox checked={form.revisit_done} tabIndex={-1} className="pointer-events-none" />
                <span>{form.revisit_done ? "완료" : "미완료"}</span>
              </div>
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
      </TabsContent>

      <TabsContent value="list" className="mt-0 space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">배송내용 상세</h2>
          <Badge variant="secondary">{records.length}건</Badge>
        </div>
          <Card className="p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">업체 검색</Label>
                <Input
                  value={searchCompany}
                  onChange={(e) => setSearchCompany(e.target.value)}
                  placeholder="업체명 부분검색 (예: 모던)"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">고객명 검색</Label>
                <Input
                  value={searchCustomer}
                  onChange={(e) => setSearchCustomer(e.target.value)}
                  placeholder="고객명 부분검색 (예: 김)"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">팀장 검색 (별칭 가능)</Label>
                <Input
                  value={searchLeader}
                  onChange={(e) => setSearchLeader(e.target.value)}
                  placeholder="예: 형주 / 동석 / 동선"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">날짜 검색</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !searchDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {searchDate ? format(searchDate, "yyyy-MM-dd") : "날짜 선택"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={searchDate}
                      onSelect={setSearchDate}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchCompany("");
                    setSearchCustomer("");
                    setSearchLeader("");
                    setSearchDate(undefined);
                  }}
                >
                  초기화
                </Button>
                <div className="text-xs text-muted-foreground">
                  {(searchCompany || searchCustomer || searchLeader || searchDate)
                    ? `검색 결과 ${filteredRecords.length}건`
                    : `전체 ${records.length}건`}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2 p-2 border-b">
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">
                  선택 {selectedIds.size}건 / 표시 {filteredRecords.length}건
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const dates = Array.from(new Set(filteredRecords.map((r: any) => r.date || "(날짜없음)")));
                    setCollapsedDates(new Set(dates));
                  }}
                >
                  모두 접기
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCollapsedDates(new Set())}
                >
                  모두 펼치기
                </Button>
                {(() => {
                  const set = new Set<string>();
                  for (const r of filteredRecords as any[]) {
                    const ids = [r.leader1_id, r.leader2_id, r.leader3_id];
                    const names = [r.leader1_name, r.leader2_name, r.leader3_name];
                    for (let i = 0; i < 3; i++) {
                      const key = ids[i] || (names[i] ? `name:${names[i]}` : "");
                      if (key) set.add(key);
                    }
                  }
                  return (
                    <Badge variant="secondary" className="ml-1 whitespace-nowrap">
                      당일근무팀장 {set.size}명
                    </Badge>
                  );
                })()}
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={bulkDeleteSelected}
                disabled={selectedIds.size === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" /> 선택 삭제
              </Button>
            </div>
            {(searchCompany || searchCustomer || searchLeader || searchDate) && filteredRecords.length === 0 && (
              <div className="p-6 text-center text-muted-foreground text-sm">검색 결과가 없습니다.</div>
            )}
            {(() => {
              const groups = new Map<string, any[]>();
              for (const r of filteredRecords) {
                const key = r.date || "(날짜없음)";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(r);
              }
              const sorted = Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
              if (sorted.length === 0 && !(searchCompany || searchCustomer || searchLeader || searchDate)) {
                return <div className="p-6 text-center text-muted-foreground text-sm">표시할 배송 내역이 없습니다.</div>;
              }
              return (
                <div className="divide-y">
                  {sorted.map(([date, rows]) => {
                    const collapsed = collapsedDates.has(date);
                    const totalFee = rows.reduce((s: number, r: any) =>
                      s + Number(r.metro_fee || 0) + Number(r.note_amount || 0) + Number(r.regional_fee || 0), 0);
                    let label = date;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                      const d = new Date(date + "T00:00:00");
                      label = format(d, "M월 d일 (E)", { locale: ko });
                    }
                    return (
                      <div key={date}>
                        <button
                          type="button"
                          onClick={() => {
                            setCollapsedDates((prev) => {
                              const next = new Set(prev);
                              if (next.has(date)) next.delete(date);
                              else next.add(date);
                              return next;
                            });
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 hover:bg-muted text-left"
                        >
                          <div className="flex items-center gap-2">
                            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            <span className="font-semibold text-sm">{label}</span>
                            <span className="text-xs text-muted-foreground">· {date}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                            <span>{rows.length}건</span>
                            <span>합계 {fmt(totalFee)}원</span>
                          </div>
                        </button>
                        {!collapsed && (
                          <div className="overflow-x-auto">
                            <RecordsTable
                              records={rows}
                              issuesByRow={issuesByRow}
                              expandedItems={expandedItems}
                              setExpandedItems={setExpandedItems}
                              editRow={editRow}
                              removeRow={removeRow}
                              displayLeaderById={displayLeaderById}
                              displaySettlementStatus={displaySettlementStatus}
                              selectedIds={selectedIds}
                              setSelectedIds={setSelectedIds}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </Card>
      </TabsContent>
      </Tabs>

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
      <Dialog open={revisitPickerOpen} onOpenChange={setRevisitPickerOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>재방문 완료 등록 — 저장된 1차 배송 선택</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              "재방문요청"으로 저장됐지만 아직 2차 입력이 없는 1차 배송 목록입니다. 한 건을 선택하면 같은 내용이 잠금된 2차 행으로 추가됩니다 (금액만 수정 가능).
            </div>
            <div className="max-h-[60vh] overflow-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="p-2">날짜</th>
                    <th className="p-2">업체</th>
                    <th className="p-2">고객</th>
                    <th className="p-2">지역</th>
                    <th className="p-2">상품</th>
                    <th className="p-2">팀장</th>
                    <th className="p-2 text-right">금액</th>
                    <th className="p-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {revisitLoading && (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">불러오는 중…</td></tr>
                  )}
                  {!revisitLoading && revisitCandidates.length === 0 && (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">미완료 1차 배송이 없습니다.</td></tr>
                  )}
                  {!revisitLoading && revisitCandidates.map((r) => {
                    const amt =
                      Number(r.metro_fee || 0) + Number(r.regional_fee || 0) +
                      Number(r.note_amount || 0) + Number(r.cod_amount || 0);
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/40">
                        <td className="p-2 whitespace-nowrap">{r.date}</td>
                        <td className="p-2">{r.company_name}</td>
                        <td className="p-2">{r.customer_name || ""}</td>
                        <td className="p-2">{r.region || ""}</td>
                        <td className="p-2 max-w-[200px] truncate" title={r.item || ""}>{r.item || ""}</td>
                        <td className="p-2">{[r.leader1_name, r.leader2_name, r.leader3_name].filter(Boolean).join(", ")}</td>
                        <td className="p-2 text-right tabular-nums">{fmt(amt)}</td>
                        <td className="p-2">
                          <Button size="sm" onClick={() => addRevisitFromExisting(r)}>선택</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisitPickerOpen(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={revisitDetectOpen} onOpenChange={(v) => { setRevisitDetectOpen(v); if (!v) { setRevisitDetectCandidates([]); setRevisitDetectIdx(null); } }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>재방문 여부 확인</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              같은 고객/지역의 과거 배송이 발견되었습니다. 재방문이면 해당 건을 선택하세요 — 그 그룹의 <b>최초 1차 배송 내용 100% 그대로</b>가 잠금된 다음 차수 행으로 자동 생성됩니다 (금액만 수정 가능). 재방문이 아니면 아래 "재방문 아님"을 누르세요.
            </div>
            <div className="max-h-[55vh] overflow-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="p-2">날짜</th>
                    <th className="p-2">업체</th>
                    <th className="p-2">고객</th>
                    <th className="p-2">지역</th>
                    <th className="p-2">상품</th>
                    <th className="p-2">팀장</th>
                    <th className="p-2 text-right">금액</th>
                    <th className="p-2 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {revisitDetectLoading && (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">검색 중…</td></tr>
                  )}
                  {!revisitDetectLoading && revisitDetectCandidates.length === 0 && (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">매칭된 과거 배송이 없습니다.</td></tr>
                  )}
                  {!revisitDetectLoading && revisitDetectCandidates.map((r) => {
                    const amt =
                      Number(r.metro_fee || 0) + Number(r.regional_fee || 0) +
                      Number(r.note_amount || 0) + Number(r.cod_amount || 0);
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/40">
                        <td className="p-2 whitespace-nowrap">{r.date}</td>
                        <td className="p-2">{r.company_name}</td>
                        <td className="p-2">{r.customer_name || ""}</td>
                        <td className="p-2">{r.region || ""}</td>
                        <td className="p-2 max-w-[200px] truncate" title={r.item || ""}>{r.item || ""}</td>
                        <td className="p-2">{[r.leader1_name, r.leader2_name, r.leader3_name].filter(Boolean).join(", ")}</td>
                        <td className="p-2 text-right tabular-nums">{fmt(amt)}</td>
                        <td className="p-2">
                          <Button size="sm" onClick={() => confirmDetectedRevisit(r)}>재방문으로</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevisitDetectOpen(false); setRevisitDetectCandidates([]); setRevisitDetectIdx(null); }}>
              재방문 아님 (새 배송으로 입력)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!dongPrompt} onOpenChange={(v) => !v && setDongPrompt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>지역구분 선택</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              배송지가 <b>'{dongPrompt}'</b> 한 단어로만 입력되어 자동 분류가 어렵습니다.
              <br />수도권/지방을 선택해 주세요. (수도권 선택 시 다음부터 자동 분류됩니다)
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  if (!dongPrompt) return;
                  setForm((f) => ({ ...f, region_type: "regional" }));
                  setDongPrompt(null);
                }}
              >
                지방
              </Button>
              <Button
                onClick={() => {
                  if (!dongPrompt) return;
                  const uid = user?.id || "anon";
                  const list = loadMetroKeywords(uid);
                  if (!list.includes(dongPrompt)) {
                    saveMetroKeywords(uid, [...list, dongPrompt]);
                    setMetroKeywordsCache(loadMetroKeywords(uid));
                  }
                  setForm((f) => ({ ...f, region_type: "metro" }));
                  toast.success(`'${dongPrompt}' → 수도권으로 저장되었습니다`);
                  setDongPrompt(null);
                }}
              >
                수도권
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
  split: string; paid: boolean; twoPerson: boolean;
  companyId: string | null;
  leaderIds: (string | null)[];
  regionType: RegionType;
  errors: RowError[];
  warnings: RowError[];
};

function PasteDialog({ open, onClose, companies, leaders, holidays, userId, defaultMonth, onSaved, onReload }: {
  open: boolean; onClose: () => void; companies: Company[]; leaders: Leader[]; holidays: Holiday[]; userId: string; defaultMonth?: string; onSaved: () => void; onReload: () => void | Promise<void>;
}) {
  const { confirm: confirmSave, dialog: saveConfirmDialog } = useSaveConfirm();
  const [text, setText] = useState("");
  // 주문 메모 자유 입력 (자동 분석 → 붙여넣기 칸에 KV 블록으로 추가)
  const [memoText, setMemoText] = useState("");
  const [memoError, setMemoError] = useState<string | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  // 기본 팀장 입력 (붙여넣은 행에 팀장이 없을 때 적용)
  const [defaultLeadersText, setDefaultLeadersText] = useState("");
  // 행별 팀장 수동 수정: rowIndex -> { l1?: id|""(=빈칸), l2?: id|"" }
  const [leaderOverrides, setLeaderOverrides] = useState<Record<number, { l1?: string; l2?: string; l3?: string }>>({});
  // 행별 수도권/지방 수동 수정
  const [regionOverrides, setRegionOverrides] = useState<Record<number, RegionType>>({});
  // 행별 날짜 수동 입력 (raw 텍스트). undefined = 자동, 그 외 = 사용자 입력
  const [dateOverrides, setDateOverrides] = useState<Record<number, string>>({});
  // 행별 2인배송 수동 토글
  const [twoOverrides, setTwoOverrides] = useState<Record<number, boolean>>({});
  // 행별 분할 수동 선택 ("" | "3분할" | "형주동석")
  const [splitOverrides, setSplitOverrides] = useState<Record<number, string>>({});
  // 일괄 적용용 입력값
  const [bulkDate, setBulkDate] = useState("");
  // 미리보기에서 사용자가 제외한 행
  const [excludedRows, setExcludedRows] = useState<Record<number, boolean>>({});

  // 사진(계약서/송장) OCR
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // 미리보기 날짜 input ref 배열 — Enter 시 다음 행으로 이동
  const dateInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // OCR 점검 (정확도 확인 + 분석결과 등록) 다이얼로그
  const [ocrCheckOpen, setOcrCheckOpen] = useState(false);

  const readFileAsDataURL = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });

  const tsvEscape = (s: string) => String(s ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();

  const handlePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files).slice(0, 20);
    if (files.length > 20) {
      toast.warning(`최대 20장까지만 처리됩니다 (${files.length}장 중 앞 20장만 사용)`);
    }
    setOcrLoading(true);
    setOcrProgress({ done: 0, total: arr.length });
    try {
      // 파일 → base64 (브라우저 메모리에만, 저장소 업로드 없음)
      const images: string[] = [];
      for (let i = 0; i < arr.length; i++) {
        images.push(await readFileAsDataURL(arr[i]));
        setOcrProgress({ done: i + 1, total: arr.length * 2 });
      }
      const { data, error } = await supabase.functions.invoke("extract-invoice", { body: { images } });
      // 메모리에서 즉시 제거
      images.length = 0;
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (error) throw error;
      const rows: Array<{ customer: string; region: string; item: string; note: string; uncertain: string[]; source: number }> =
        (data?.rows as any[]) ?? [];
      const errors: Array<{ index: number; message: string }> = (data?.errors as any[]) ?? [];
      if (rows.length === 0) {
        toast.error(errors[0]?.message || "사진에서 정보를 찾지 못했습니다");
        return;
      }
      // 기존 텍스트가 TSV 헤더로 시작하는지 확인, 없으면 헤더 추가
      const headers = ["고객명", "배송지", "품목", "비고"];
      const headerLine = headers.join("\t");
      const prev = text.replace(/\s+$/, "");
      const hasHeader = prev.split("\n").some((l) => l.trim() === headerLine);
      const newLines: string[] = [];
      if (!prev || !hasHeader) newLines.push(headerLine);
      const mark = (v: string, key: string, uncertain: string[]) =>
        uncertain.includes(key) ? (v ? `체크요망:${v}` : "체크요망") : v;
      for (const r of rows) {
        newLines.push([
          tsvEscape(mark(r.customer, "customer", r.uncertain)),
          tsvEscape(mark(r.region, "region", r.uncertain)),
          tsvEscape(mark(r.item, "item", r.uncertain)),
          tsvEscape(mark(r.note, "note", r.uncertain)),
        ].join("\t"));
      }
      const next = (prev ? prev + "\n" : "") + newLines.join("\n");
      setText(next);
      toast.success(`${rows.length}건 추출 완료${errors.length ? ` (${errors.length}장 실패)` : ""}`);
    } catch (e: any) {
      toast.error(`사진 분석 실패: ${e?.message || String(e)}`);
    } finally {
      setOcrLoading(false);
      setOcrProgress(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const leaderIndex = useMemo(() => buildLeaderIndex(leaders), [leaders]);

  // OCR 점검에서 등록된 추출 결과를 텍스트(TSV)로 합치기 (handlePhotos와 동일 포맷)
  const appendExtractedRows = (rows: ExtractedRow[]) => {
    if (!rows || rows.length === 0) return;
    const headers = ["고객명", "배송지", "품목", "비고"];
    const headerLine = headers.join("\t");
    const prev = text.replace(/\s+$/, "");
    const hasHeader = prev.split("\n").some((l) => l.trim() === headerLine);
    const newLines: string[] = [];
    if (!prev || !hasHeader) newLines.push(headerLine);
    const mark = (v: string, key: string, uncertain: string[]) =>
      uncertain.includes(key) ? (v ? `체크요망:${v}` : "체크요망") : v;
    for (const r of rows) {
      newLines.push([
        tsvEscape(mark(r.customer, "customer", r.uncertain)),
        tsvEscape(mark(r.region, "region", r.uncertain)),
        tsvEscape(mark(r.item, "item", r.uncertain)),
        tsvEscape(mark(r.note, "note", r.uncertain)),
      ].join("\t"));
    }
    const next = (prev ? prev + "\n" : "") + newLines.join("\n");
    setText(next);
    setOcrCheckOpen(false);
  };
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
      tooMany: extracted.ids.length >= 4,
    };
  }, [defaultLeadersText, leaderIndex]);

  // 붙여넣은 원본을 grid로 변환
  const grid = useMemo<string[][]>(() => {
    if (!text.trim()) return [];
    const kv = tryParseKeyValueText(text);
    if (kv) return kv;
    return parsePastedTableText(text);
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

  // 제목(헤더 윗부분) 행에서 팀장명 자동 인식 → 기본 팀장 입력란이 비어있으면 자동 채움
  const titleLeaderHint = useMemo(() => {
    if (grid.length === 0) return null;
    const titleRows = headerInfo.hasHeader ? grid.slice(0, headerInfo.dataStart - 1) : grid.slice(0, Math.min(3, grid.length));
    const titleText = titleRows.map((r) => r.join(" ")).join("\n").trim();
    if (!titleText) return null;
    const ex = extractLeaders(titleText, leaderIndex);
    if (ex.ids.length === 0) return null;
    const names = ex.ids.slice(0, 3).map((id) => leaderById.get(id)?.name || "").filter(Boolean);
    return { ids: ex.ids.slice(0, 3), names, raw: titleText };
  }, [grid, headerInfo, leaderIndex, leaderById]);

  useEffect(() => {
    if (titleLeaderHint && !defaultLeadersText.trim()) {
      setDefaultLeadersText(titleLeaderHint.names.join("/"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleLeaderHint]);

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
    // 헤더 없을 때 기존 순서로 기본 매핑 (있는 만큼만)
    if (!headerInfo.hasHeader && colCount >= 14) {
      // colCount >= 15 (또는 18=전체 COLS)일 때만 팀장3 자리를 포함해 leader3까지 매핑.
      // 그 외에는 leader3를 건너뛰어 컬럼 밀림 방지.
      const fallback: FieldKey[] = colCount >= 15
        ? ["date","company","leader1","leader2","leader3","customer","region","item","note","metro","noteAmt","regional","cod","split","paid","twoPerson"]
        : ["date","company","leader1","leader2","customer","region","item","note","metro","noteAmt","regional","cod","split","paid","twoPerson"];
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
      const l3 = cell(row, "leader3"); if (l3) parts.push(l3);
      if (parts.length === 0) {
        // 미매핑 셀들에서 후보를 찾는다
        for (let i = 0; i < row.length; i++) if (!mapping[i]) {
          const v = (row[i] ?? "").trim();
          if (v) parts.push(v);
        }
      }
      return parts.join("\n");
    };

    return dataRows.map((cols) => {
      const errors: RowError[] = [];
      const warnings: RowError[] = [];
      // 노이즈로 의심되는 행(합계/구분선/안내문 등)도 누락 없이 표시.
      // 사용자가 확인 후 직접 제외할 수 있도록 경고만 부여.
      const looksNoisy = isSkippablePasteRow(cols);
      if (looksNoisy) warnings.push({ field: "행", msg: "노이즈 의심 — 확인 필요" });

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
      let leaderIds: (string | null)[] = [
        effectiveIds[0] || null,
        effectiveIds[1] || null,
        effectiveIds[2] || null,
      ];
      // 인식 실패 시: 원문을 정식 이름으로 정규화 시도 (별칭/공백 흡수). 매칭 실패하면 trim 원문.
      const fallbackNames: (string | null)[] = [
        cell(cols, "leader1") ? canonicalLeaderName(cell(cols, "leader1"), leaders) : null,
        cell(cols, "leader2") ? canonicalLeaderName(cell(cols, "leader2"), leaders) : null,
        cell(cols, "leader3") ? canonicalLeaderName(cell(cols, "leader3"), leaders) : null,
      ];
      const leaderNames: (string | null)[] = leaderIds.map((id, i) =>
        id ? leaderById.get(id)?.name || null : fallbackNames[i]
      );
      // 미등록 팀장: 텍스트에는 이름이 있는데 매칭 실패한 경우
      if (!usedDefault && leaderText && extracted.ids.length === 0 && leaderText.replace(LEADER_SPLIT_RE, "").length > 0) {
        errors.push({ field: "팀장", msg: `미등록 팀장: ${leaderText}` });
      }
      if (effectiveIds.length >= 4) {
        warnings.push({ field: "팀장", msg: `${effectiveIds.length}명 인식 — 앞 3명만 사용 (팀장4 이상 미사용)` });
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

      // 분할 컬럼 정규화 — 다양한 표기를 허용 값(빈칸 / 3분할 / 형주동석)으로 매핑
      const splitRaw = cell(cols, "split").trim();
      const splitNorm = splitRaw.replace(/\s+/g, "").toLowerCase();
      let split = "";
      if (["3분할", "삼분할", "1/3", "33%", "3split", "three"].includes(splitNorm)) split = "3분할";
      else if (["형주동석", "형동", "강신", "강형주신동석", "동석형주", "hd", "hyungdong"].includes(splitNorm)) split = "형주동석";
      else if (["", "없음", "기본", "일반", "none", "no", "-"].includes(splitNorm)) split = "";
      else split = ""; // 알 수 없는 값은 빈칸으로 안전 처리
      const paidRaw = cell(cols, "paid").toLowerCase();
      const paid = ["o", "y", "yes", "true", "완료", "결제", "✓", "v", "결제완료"].includes(paidRaw) || paidRaw === "1";
      const twoRaw = cell(cols, "twoPerson").toLowerCase();
      const twoPerson = ["o","y","yes","true","✓","v","2인","2인배송","이인배송"].includes(twoRaw) || twoRaw === "1";

      // 실제 배송 행 판단: 신호 ≥ 2개
      let signals = 0;
      if (date) signals++;
      if (company) signals++;
      if (leaderIds.some(Boolean)) signals++;
      if (customer) signals++;
      if (item) signals++;
      if (metro + noteAmt + regional + cod > 0) signals++;
      // 100건 붙여넣으면 100건이 그대로 잡히도록, 빈 신호 행도 누락하지 않고
      // 오류로 표시하여 사용자가 확인/제외할 수 있게 한다.
      if (signals < 1) errors.push({ field: "행", msg: "유효 데이터 없음" });

      // 신호가 충분한데 날짜만 없으면 위 lastDate가 fill-down 처리됨 (이미 위에서 적용)

      return {
        raw: cols, rawDate, autoDate, company,
        leaders: leaderNames,
        customer, region, item, note,
        metro, noteAmt, regional, cod,
        split, paid, twoPerson,
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
    const c = applyOne(r.leaderIds[2], r.leaders[2], ov.l3);
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
      leaderIds: [a.id, b.id, c.id] as (string | null)[],
      leaders: [a.name, b.name, c.name] as (string | null)[],
      regionType,
      twoPerson: twoOverrides[i] !== undefined ? twoOverrides[i] : r.twoPerson,
      split: splitOverrides[i] !== undefined ? splitOverrides[i] : r.split,
      errors,
      warnings,
    };
    });
  }, [parsed, leaderOverrides, leaderById, regionOverrides, dateOverrides, twoOverrides, splitOverrides, defaultMonth]);

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
    const { error } = await supabase
      .from("companies")
      .upsert(rows, { onConflict: "user_id,name", ignoreDuplicates: true });
    setRegistering(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length}개 업체 자동등록 완료`);
    await onReload();
  };

  // 미등록 팀장 목록
  const VIRTUAL_LEADER_KEYWORDS: string[] = ["가상", "virtual", "가상기사", "가상팀장"];
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
    const { error } = await supabase
      .from("team_leaders")
      .upsert(rows, { onConflict: "user_id,name", ignoreDuplicates: true });
    setRegistering(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length}명 팀장 자동등록 완료`);
    await onReload();
  };

  // ─── 붙여넣기 자동 등록: 텍스트가 채워지면 미등록 업체/팀장을 자동으로 등록 ───
  const autoRegisteredRef = useRef<{ c: Set<string>; l: Set<string> }>({ c: new Set(), l: new Set() });
  useEffect(() => {
    if (!text.trim()) {
      autoRegisteredRef.current = { c: new Set(), l: new Set() };
    }
  }, [text]);
  useEffect(() => {
    if (!userId || registering) return;
    if (!text.trim()) return;
    const newC = unregisteredCompanies.filter((n) => !autoRegisteredRef.current.c.has(n));
    const newL = unregisteredLeaders.filter((n) => !autoRegisteredRef.current.l.has(n));
    if (newC.length === 0 && newL.length === 0) return;
    const t = setTimeout(async () => {
      if (newC.length > 0) {
        newC.forEach((n) => autoRegisteredRef.current.c.add(n));
        await registerCompanies();
      }
      if (newL.length > 0) {
        newL.forEach((n) => autoRegisteredRef.current.l.add(n));
        await registerLeaders();
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unregisteredCompanies, unregisteredLeaders, userId, text, registering]);

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
      leader3_id: r.leaderIds[2], leader3_name: r.leaders[2],
      customer_name: r.customer || null,
      region: r.region || null,
      region_type: r.regionType === "unknown" ? null : r.regionType,
      item: r.item || null,
      note: r.note || null,
      metro_fee: r.metro, note_amount: r.noteAmt, regional_fee: r.regional, cod_amount: r.cod,
      split_type: r.split || null, paid: r.paid,
      two_person: r.twoPerson,
    }));
    const { error } = await supabase.from("deliveries").insert(rows);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rows.length}건 저장 완료`);
    setText("");
    setLeaderOverrides({});
    setRegionOverrides({});
    setDateOverrides({});
    setTwoOverrides({});
    setSplitOverrides({});
    setBulkDate("");
    setExcludedRows({});
    onSaved();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] sm:max-w-[98vw] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>엑셀 붙여넣기 (자동 분류)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 flex-1 min-h-0 overflow-y-auto px-6 pb-4">
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
            {titleLeaderHint && (
              <div className="text-[11px] text-muted-foreground">
                제목 행에서 팀장 인식: <b>{titleLeaderHint.names.join(" / ")}</b>
              </div>
            )}
            {defaultLeadersText.trim() && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {defaultLeaderInfo.ids.slice(0, 3).map((id, i) => {
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
                    {defaultLeaderInfo.ids.length}명 입력 — 앞 3명만 사용. 미리보기에서 확인하세요.
                  </Badge>
                )}
                {defaultLeaderInfo.unknown.map((u) => (
                  <Badge key={u} variant="destructive">미등록: {u}</Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handlePhotos(e.target.files)}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handlePhotos(e.target.files)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={ocrLoading}
                >
                  {ocrLoading ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Camera className="h-3 w-3 mr-1" />
                  )}
                  계약서·송장 사진 (최대 20장)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs md:hidden"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={ocrLoading}
                >
                  <Camera className="h-3 w-3 mr-1" />
                  카메라 촬영
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setOcrCheckOpen(true)}
                  disabled={ocrLoading}
                >
                  <ScanSearch className="h-3 w-3 mr-1" />
                  OCR 점검 (최대 10장)
                </Button>
                {ocrProgress && (
                  <span className="text-[11px] text-muted-foreground">
                    분석 중… {ocrProgress.done}/{ocrProgress.total}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  사진은 분석 후 즉시 폐기 (저장 안 함). 애매한 값은 “체크요망” 표시 → 수동 보정.
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => { setText(""); setExcludedRows({}); }}
                disabled={!text && Object.keys(excludedRows).length === 0}
              >
                <Trash2 className="h-3 w-3 mr-1" />전체삭제
              </Button>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="엑셀에서 헤더 포함 여러 행/열을 복사해 붙여넣으세요 (Ctrl+V)"
              rows={8}
              wrap="off"
              className="paste-area font-mono text-xs whitespace-pre overflow-x-auto"
            />
          </div>

          <div className="border rounded p-3 space-y-2 bg-muted/20">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm font-semibold">주문 메모 자동 분석 (선택)</Label>
              <span className="text-[11px] text-muted-foreground">
                고객명/주소/품목/배송일/배송비/연락처 등을 자유 형식으로 붙여넣으면 자동 추출 → 위 붙여넣기 칸에 추가됩니다.
              </span>
            </div>
            <Textarea
              value={memoText}
              onChange={(e) => { setMemoText(e.target.value); setMemoError(null); }}
              placeholder={`예시)
일산메종드르블랑
고객명:문지연
연락처:010-0000-0000
주소:대구광역시 동구 ...
모델:세라믹 식탁
배송비 12만원 고객님착불
배송일:6월5일(금)`}
              rows={6}
              className="text-xs"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => {
                  const kv = parseOrderMemoToKV(memoText);
                  if (!kv) { setMemoError("분석할 내용을 찾지 못했습니다."); return; }
                  setText((prev) => (prev && prev.trim() ? prev.replace(/\s+$/,"") + "\n\n" + kv : kv));
                  setMemoText("");
                  setMemoError(null);
                }}
                disabled={!memoText.trim()}
              >
                분석하여 추가
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => { setMemoText(""); setMemoError(null); }}
                disabled={!memoText}
              >
                <Trash2 className="h-3 w-3 mr-1" />지우기
              </Button>
              {memoError && <span className="text-[11px] text-destructive">{memoError}</span>}
            </div>
          </div>

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
                  붙여넣기 <b>{grid.length - headerInfo.dataStart}</b>행 · 자동감지 <b>{effective.length}</b>건 · 미리보기 <b>{visible.length}</b>건 · 오류 <span className="text-destructive font-semibold">{errorCount}</span>건
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
              <div className="flex flex-wrap items-center gap-2 border rounded p-2 bg-muted/30">
                <span className="text-xs font-semibold">분할 일괄</span>
                <Select
                  onValueChange={(v) => {
                    const target = v === "__none__" ? "" : v;
                    const next: Record<number, string> = {};
                    for (const { i } of visible) next[i] = target;
                    setSplitOverrides((p) => ({ ...p, ...next }));
                    toast.success(`${visible.length}건 분할: ${target || "(빈칸)"} 적용`);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue placeholder="선택…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(빈칸)</SelectItem>
                    <SelectItem value="3분할">3분할</SelectItem>
                    <SelectItem value="형주동석">형주동석</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setSplitOverrides({})}>초기화</Button>
                <span className="text-[10px] text-muted-foreground ml-1">개별 행은 표의 분할 열에서 직접 변경할 수 있습니다.</span>
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
                      <TableHead className="whitespace-nowrap min-w-[120px]">팀장3</TableHead>
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
                      <TableHead className="whitespace-nowrap min-w-[100px]">2인배송</TableHead>
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
                      const leaderCell = (slot: 0 | 1 | 2) => {
                        const key = (slot === 0 ? "l1" : slot === 1 ? "l2" : "l3") as "l1" | "l2" | "l3";
                        const ovVal = leaderOverrides[i]?.[key];
                        const current = ovVal !== undefined ? ovVal : (r.leaderIds[slot] || "");
                        const unknown = !current && !!r.leaders[slot];
                        return (
                          <LeaderCombobox
                            leaders={selectableLeaders}
                            value={current}
                            onChange={(v) => setLeaderOverrides((prev) => ({
                              ...prev,
                              [i]: { ...prev[i], [key]: v },
                            }))}
                            placeholder={r.leaders[slot] || "팀장 입력"}
                            className={unknown ? "[&_input]:border-destructive [&_input]:text-destructive" : ""}
                          />
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
                                ref={(el) => { dateInputRefs.current[displayIdx] = el; }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const next = dateInputRefs.current[displayIdx + 1];
                                    if (next) {
                                      next.focus();
                                      next.select();
                                    }
                                  }
                                }}
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
                          <TableCell>{leaderCell(2)}</TableCell>
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
                          <TableCell>
                            <Select
                              value={r.twoPerson ? "yes" : "no"}
                              onValueChange={(v) => setTwoOverrides((p) => ({ ...p, [i]: v === "yes" }))}
                            >
                              <SelectTrigger className="h-7 text-xs min-w-[80px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="no">아니오</SelectItem>
                                <SelectItem value="yes">예</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={r.split || "__none__"}
                              onValueChange={(v) => setSplitOverrides((p) => ({ ...p, [i]: v === "__none__" ? "" : v }))}
                            >
                              <SelectTrigger className="h-7 text-xs min-w-[90px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">(빈칸)</SelectItem>
                                <SelectItem value="3분할">3분할</SelectItem>
                                <SelectItem value="형주동석">형주동석</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
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
        <DialogFooter className="px-6 py-3 border-t bg-background shrink-0 sticky bottom-0">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={saving || visible.length === 0 || missingRequired.length > 0}>
            {skipErrors ? `정상 ${visible.length - errorCount}건 저장` : `${visible.length}건 저장`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={ocrCheckOpen} onOpenChange={setOcrCheckOpen}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>OCR 점검 · 분석 후 등록 (최대 10장)</DialogTitle>
        </DialogHeader>
        <OcrCheckPanel max={10} onRegister={appendExtractedRows} />
      </DialogContent>
    </Dialog>
    </>
  );
}