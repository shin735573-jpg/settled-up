import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Camera, Loader2, RefreshCw, Trash2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Field = "customer" | "region" | "item" | "note";
const FIELDS: { key: Field; label: string }[] = [
  { key: "customer", label: "고객명" },
  { key: "region", label: "배송지" },
  { key: "item", label: "품목" },
  { key: "note", label: "비고" },
];

const TSV_HEADERS = ["고객명", "배송지", "품목", "비고"] as const;
const TSV_COL_COUNT = TSV_HEADERS.length;
const MAX_FIELD_LEN = 200;

/**
 * 추출 결과가 TSV(고객명/배송지/품목/비고) 등록 규칙을 만족하는지 검증.
 * 실패한 항목은 { index, fileName, reasons[] } 형태로 반환.
 * 규칙:
 *  - 4개 필드(customer/region/item/note)가 모두 string 이어야 함
 *  - 값에 탭/개행/캐리지리턴 포함 불가 (TSV 열 깨짐 방지)
 *  - 각 값 길이 ≤ MAX_FIELD_LEN
 *  - customer/region/item 중 최소 1개 이상 비어있지 않아야 함
 */
export type ExtractRowError = { index: number; fileName: string; reasons: string[] };
export function validateExtractedRowsForTsv(
  rows: Array<ExtractedRow & { __fileName?: string }>,
): ExtractRowError[] {
  const errors: ExtractRowError[] = [];
  rows.forEach((r, i) => {
    const reasons: string[] = [];
    const values: Array<[Field, unknown]> = [
      ["customer", r.customer],
      ["region", r.region],
      ["item", r.item],
      ["note", r.note],
    ];
    if (values.length !== TSV_COL_COUNT) {
      reasons.push(`열 개수 불일치 (${values.length}/${TSV_COL_COUNT})`);
    }
    for (const [k, v] of values) {
      if (typeof v !== "string") {
        reasons.push(`${k}: 문자열 아님`);
        continue;
      }
      if (/[\t\r\n]/.test(v)) reasons.push(`${k}: 탭·개행 포함 (TSV 열이 깨질 수 있음)`);
      if (v.length > MAX_FIELD_LEN) reasons.push(`${k}: 길이 초과 (${v.length}>${MAX_FIELD_LEN})`);
    }
    const meaningful =
      (typeof r.customer === "string" && r.customer.trim()) ||
      (typeof r.region === "string" && r.region.trim()) ||
      (typeof r.item === "string" && r.item.trim());
    if (!meaningful) reasons.push("고객명/배송지/품목 중 최소 1개 필요");
    if (reasons.length > 0) {
      errors.push({ index: i + 1, fileName: r.__fileName ?? `샘플 ${i + 1}`, reasons });
    }
  });
  return errors;
}

type ExtractedRow = { customer: string; region: string; item: string; note: string; uncertain: string[] };

type Sample = {
  id: string;
  fileName: string;
  dataUrl: string;
  expected: Record<Field, string>;
  actual?: Record<Field, string>;
  uncertain?: string[];
  status: "idle" | "running" | "done" | "error";
  errorMsg?: string;
};

const readFileAsDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const norm = (s: string) =>
  (s ?? "").toString().normalize("NFKC").replace(/[\s\u200b]+/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

function fieldMatch(expected: string, actual: string): "match" | "partial" | "miss" | "empty" {
  const e = norm(expected);
  const a = norm(actual);
  if (!e && !a) return "empty";
  if (!e) return "empty";
  if (!a) return "miss";
  if (e === a) return "match";
  if (e.includes(a) || a.includes(e)) return "partial";
  const big = e.length >= a.length ? e : a;
  const small = e.length < a.length ? e : a;
  let hit = 0;
  for (const ch of small) if (big.includes(ch)) hit++;
  if (hit / small.length >= 0.7) return "partial";
  return "miss";
}

export interface OcrCheckPanelProps {
  /** 최대 업로드 장수 (기본 10) */
  max?: number;
  /** "등록" 버튼: 분석된 결과(추출값)를 외부로 전달. 지정 시 등록 버튼이 노출됨. */
  onRegister?: (rows: ExtractedRow[]) => void;
  /** 등록 후 자동으로 샘플 초기화 (기본 true) */
  clearOnRegister?: boolean;
}

export default function OcrCheckPanel({ max = 10, onRegister, clearOnRegister = true }: OcrCheckPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [registerErrors, setRegisterErrors] = useState<ExtractRowError[]>([]);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = Math.max(0, max - samples.length);
    if (remaining <= 0) {
      toast.warning(`최대 ${max}장까지 추가할 수 있습니다`);
      return;
    }
    const incoming = Array.from(files);
    if (incoming.length > remaining) {
      toast.warning(`최대 ${max}장 제한: 앞 ${remaining}장만 추가됩니다`);
    }
    const arr = incoming.slice(0, remaining);
    const next: Sample[] = [];
    for (const f of arr) {
      try {
        const dataUrl = await readFileAsDataURL(f);
        next.push({
          id: crypto.randomUUID(),
          fileName: f.name,
          dataUrl,
          expected: { customer: "", region: "", item: "", note: "" },
          status: "idle",
        });
      } catch {
        toast.error(`${f.name} 읽기 실패`);
      }
    }
    setSamples((prev) => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const setExpected = (id: string, key: Field, val: string) =>
    setSamples((p) => p.map((s) => (s.id === id ? { ...s, expected: { ...s.expected, [key]: val } } : s)));

  const remove = (id: string) => setSamples((p) => p.filter((s) => s.id !== id));
  const clearAll = () => setSamples([]);

  const analyze = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    setSamples((p) => p.map((s) => (ids.includes(s.id) ? { ...s, status: "running", errorMsg: undefined } : s)));
    try {
      const targets = samples.filter((s) => ids.includes(s.id));
      const images = targets.map((s) => s.dataUrl);
      const { data, error } = await supabase.functions.invoke("extract-invoice", { body: { images } });
      if (error) throw error;
      const rows: any[] = Array.isArray(data?.rows) ? data.rows : [];
      const errs: any[] = Array.isArray(data?.errors) ? data.errors : [];
      const bySource = new Map<number, any>();
      for (const r of rows) {
        const idx = Number(r.source ?? 0);
        if (!bySource.has(idx)) bySource.set(idx, r);
      }
      setSamples((p) =>
        p.map((s) => {
          const i = targets.findIndex((t) => t.id === s.id);
          if (i < 0) return s;
          const r = bySource.get(i + 1);
          const errMatch = errs.find((e) => Number(e.index) === i + 1);
          if (errMatch) return { ...s, status: "error", errorMsg: String(errMatch.message ?? "오류") };
          if (!r) return { ...s, status: "error", errorMsg: "추출 결과 없음" };
          return {
            ...s,
            status: "done",
            actual: {
              customer: String(r.customer ?? ""),
              region: String(r.region ?? ""),
              item: String(r.item ?? ""),
              note: String(r.note ?? ""),
            },
            uncertain: Array.isArray(r.uncertain) ? r.uncertain.map(String) : [],
          };
        }),
      );
      toast.success(`${ids.length}건 분석 완료`);
    } catch (e: any) {
      const msg = e?.message ?? "분석 실패";
      setSamples((p) => p.map((s) => (ids.includes(s.id) ? { ...s, status: "error", errorMsg: msg } : s)));
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const done = samples.filter((s) => s.status === "done");

  const stats = (() => {
    let total = 0, match = 0, partial = 0, miss = 0;
    const perField: Record<Field, { m: number; p: number; x: number; total: number }> = {
      customer: { m: 0, p: 0, x: 0, total: 0 },
      region: { m: 0, p: 0, x: 0, total: 0 },
      item: { m: 0, p: 0, x: 0, total: 0 },
      note: { m: 0, p: 0, x: 0, total: 0 },
    };
    for (const s of done) {
      for (const { key } of FIELDS) {
        if (!s.expected[key]) continue;
        const r = fieldMatch(s.expected[key], s.actual?.[key] ?? "");
        if (r === "empty") continue;
        total++;
        perField[key].total++;
        if (r === "match") { match++; perField[key].m++; }
        else if (r === "partial") { partial++; perField[key].p++; }
        else { miss++; perField[key].x++; }
      }
    }
    const acc = total > 0 ? Math.round(((match + partial * 0.5) / total) * 1000) / 10 : 0;
    return { total, match, partial, miss, acc, perField };
  })();

  const handleRegister = () => {
    if (!onRegister) return;
    if (done.length === 0) {
      toast.warning("등록할 분석 결과가 없습니다 (먼저 분석 실행)");
      return;
    }
    const rowsWithFile = done.map((s) => ({
      customer: s.actual?.customer ?? "",
      region: s.actual?.region ?? "",
      item: s.actual?.item ?? "",
      note: s.actual?.note ?? "",
      uncertain: s.uncertain ?? [],
      __fileName: s.fileName,
    }));
    const errs = validateExtractedRowsForTsv(rowsWithFile);
    if (errs.length > 0) {
      setRegisterErrors(errs);
      toast.error(`검증 실패: ${errs.length}건 (수정 후 다시 등록)`);
      return;
    }
    setRegisterErrors([]);
    const rows: ExtractedRow[] = rowsWithFile.map(({ __fileName, ...r }) => r);
    onRegister(rows);
    toast.success(`${rows.length}건 등록`);
    if (clearOnRegister) setSamples([]);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => onPick(e.target.files)}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={busy || samples.length >= max} size="sm">
            <Camera className="h-4 w-4 mr-1" /> 샘플 추가 ({samples.length}/{max})
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => analyze(samples.filter((s) => s.status !== "running").map((s) => s.id))}
            disabled={busy || samples.length === 0}
          >
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            전체 분석
          </Button>
          {onRegister && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRegister}
              disabled={busy || done.length === 0}
            >
              분석결과 등록 ({done.length})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={clearAll} disabled={busy || samples.length === 0}>
            <Trash2 className="h-4 w-4 mr-1" /> 전체 삭제
          </Button>
          {done.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">평가 {stats.total}</Badge>
              <Badge className="bg-green-600">정확 {stats.match}</Badge>
              <Badge className="bg-yellow-500">부분 {stats.partial}</Badge>
              <Badge variant="destructive">불일치 {stats.miss}</Badge>
              <Badge variant="secondary">정확도 {stats.acc}%</Badge>
            </div>
          )}
        </div>
        {done.length > 0 && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {FIELDS.map(({ key, label }) => {
              const f = stats.perField[key];
              const acc = f.total > 0 ? Math.round(((f.m + f.p * 0.5) / f.total) * 1000) / 10 : 0;
              return (
                <div key={key} className="border rounded p-2">
                  <div className="font-semibold">{label}</div>
                  <div className="text-muted-foreground">평가 {f.total} · ✓{f.m} · ~{f.p} · ✗{f.x}</div>
                  <div className="font-mono">{acc}%</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {samples.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          위 "샘플 추가"를 눌러 계약서/송장 이미지를 업로드하세요. (최대 {max}장)
        </Card>
      )}

      <div className="space-y-3">
        {samples.map((s) => (
          <Card key={s.id} className="p-3">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="lg:w-64 shrink-0">
                <img src={s.dataUrl} alt={s.fileName} className="w-full h-48 object-contain border rounded bg-muted/30" />
                <div className="mt-1 text-xs text-muted-foreground truncate">{s.fileName}</div>
                <div className="mt-2 flex gap-1">
                  <Button size="sm" variant="default" onClick={() => analyze([s.id])} disabled={busy}>
                    {s.status === "running" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    {s.status === "done" || s.status === "error" ? "재분석" : "분석"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => remove(s.id)} disabled={busy}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {s.status === "error" && (
                  <div className="mt-2 text-xs text-destructive flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5" /> {s.errorMsg}
                  </div>
                )}
                {s.uncertain && s.uncertain.length > 0 && (
                  <div className="mt-2 text-xs text-yellow-700">
                    체크요망: {s.uncertain.join(", ")}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">필드</TableHead>
                      <TableHead>기대값 (정답)</TableHead>
                      <TableHead>추출값</TableHead>
                      <TableHead className="w-20">결과</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {FIELDS.map(({ key, label }) => {
                      const exp = s.expected[key];
                      const act = s.actual?.[key] ?? "";
                      const r = s.actual ? fieldMatch(exp, act) : "empty";
                      return (
                        <TableRow key={key}>
                          <TableCell className="font-medium">{label}</TableCell>
                          <TableCell>
                            <Input
                              value={exp}
                              onChange={(e) => setExpected(s.id, key, e.target.value)}
                              placeholder="정답 입력"
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{act || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            {!s.actual ? (
                              <span className="text-xs text-muted-foreground">대기</span>
                            ) : r === "match" ? (
                              <Badge className="bg-green-600 gap-1"><CheckCircle2 className="h-3 w-3" /> 정확</Badge>
                            ) : r === "partial" ? (
                              <Badge className="bg-yellow-500">부분</Badge>
                            ) : r === "empty" ? (
                              <Badge variant="outline">제외</Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> 불일치</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export type { ExtractedRow };