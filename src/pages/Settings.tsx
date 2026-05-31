import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useArrowKeyNav } from "@/hooks/useArrowKeyNav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus, CheckCircle2, AlertCircle, XCircle, ChevronDown, ChevronUp, FileSpreadsheet, Copy, Share2, Globe } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { detectDuplicates, findAliasConflict, findDisplayNameConflict, getDisplayName, resolveLeaderName } from "@/lib/leaderResolver";
import { compareLeadersByFeeAsc } from "@/lib/leaderSort";
import {
  loadCompanySettings, saveCompanySettings, type CompanySettings,
} from "@/lib/companySettings";
import {
  DEFAULT_METRO_KEYWORDS,
  loadMetroKeywords,
  saveMetroKeywords,
  classifyRegion,
} from "@/lib/regionClassifier";
import { Textarea } from "@/components/ui/textarea";
import {
  runBackup,
  getAutoBackupEnabled,
  setAutoBackupEnabled,
  getLastBackupAt,
} from "@/lib/excelBackup";
import {
  parseBackupFile,
  restoreBackup,
  RESTORABLE_TABLES,
  type ParsedBackup,
  type RestoreMode,
  type RestoreResult,
  type BatchError,
} from "@/lib/excelBackup";
import { validateBackupForRestore, type RestoreValidationResult } from "@/lib/restoreValidation";

type Company = {
  id: string;
  name: string;
  issues_invoice: boolean;
  account_number: string | null;
  settlement_cycle: "biweekly" | "monthly";
  rejected_leader_id: string | null;
  rejected_leader_id_2: string | null;
  rejected_leader_id_3: string | null;
  has_cod: boolean;
  active: boolean;
};
type Leader = {
  id: string;
  name: string;
  region: string | null;
  is_rejected: boolean;
  fee_rate_metro: number;
  fee_rate_regional: number;
  settle_to_id: string | null;
  active: boolean;
  aliases: string[];
  display_suffix: string | null;
  issues_invoice: boolean;
  account_number: string | null;
  settle_status: "included" | "excluded";
  min_guarantee_enabled: boolean;
  min_guarantee_amount: number;
};
type Holiday = { id: string; date: string; scope: string; team_leader_id: string | null };

export default function Settings() {
  const rootRef = useRef<HTMLDivElement>(null);
  useArrowKeyNav(rootRef);
  return (
    <div className="space-y-4" ref={rootRef}>
      <h1 className="text-2xl font-bold">설정</h1>
      <Tabs defaultValue="company">
        <div className="overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
          <TabsList className="inline-flex w-max md:w-auto">
            <TabsTrigger value="company">회사 설정</TabsTrigger>
            <TabsTrigger value="companies">업체관리</TabsTrigger>
            <TabsTrigger value="leaders">팀장관리</TabsTrigger>
            <TabsTrigger value="common-deductions">공통공제관리</TabsTrigger>
            <TabsTrigger value="region">지역분류</TabsTrigger>
            <TabsTrigger value="share">앱 공유</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="company"><CompanyTab /></TabsContent>
        <TabsContent value="companies"><CompaniesTab /></TabsContent>
        <TabsContent value="leaders"><LeadersTab /></TabsContent>
        <TabsContent value="common-deductions"><CommonDeductionsTab /></TabsContent>
        <TabsContent value="region"><RegionKeywordsTab /></TabsContent>
        <TabsContent value="share"><ShareAppTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function CompanyTab() {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const [s, setS] = useState<CompanySettings>(() => loadCompanySettings(uid));
  useEffect(() => { setS(loadCompanySettings(uid)); }, [uid]);

  const update = (patch: Partial<CompanySettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveCompanySettings(uid, next);
  };

  return (
    <div className="space-y-4 max-w-2xl">
    <Card className="p-6 space-y-5 max-w-2xl">
      <div>
        <h2 className="font-semibold mb-1">회사 설정</h2>
        <p className="text-xs text-muted-foreground">
          저장 즉시 모든 화면(정산서·본사정산·한눈요약 등)에 반영됩니다.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm">회사명</Label>
          <Input
            className="mt-1"
            value={s.companyName}
            onChange={(e) => update({ companyName: e.target.value })}
            placeholder="예: 삼호물류"
          />
        </div>
        <div>
          <Label className="text-sm">기본 정산월</Label>
          <Input
            type="month"
            className="mt-1"
            value={s.defaultMonth}
            onChange={(e) => update({ defaultMonth: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            적재비 일자 입력 시 이 정산월을 기준으로 월·일이 자동 변환됩니다.
          </p>
        </div>
        <div className="md:col-span-2">
          <Label className="text-sm">기본 계좌번호</Label>
          <Input
            className="mt-1"
            value={s.defaultAccount}
            onChange={(e) => update({ defaultAccount: e.target.value })}
            placeholder="예: 신한 110-123-456789"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            업체별 계좌번호가 있으면 그 계좌가 우선 적용됩니다.
          </p>
        </div>
        <div className="md:col-span-2">
          <Label className="text-sm">정산서 하단 안내문</Label>
          <Input
            className="mt-1"
            value={s.footerNote}
            onChange={(e) => update({ footerNote: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 pt-2 border-t">
        <Checkbox
          id="oeunkyu-special"
          checked={s.oeunkyuSpecial}
          onCheckedChange={(v) => update({ oeunkyuSpecial: !!v })}
        />
        <Label htmlFor="oeunkyu-special" className="text-sm font-normal cursor-pointer">
          오은규 특수정산 적용 (오은규 금액을 오동선에게 합산)
        </Label>
      </div>
    </Card>
    <BackupCard uid={uid} />
    </div>
  );
}

function BackupCard({ uid }: { uid: string }) {
  const [auto, setAuto] = useState<boolean>(() => getAutoBackupEnabled(uid));
  const [lastAt, setLastAt] = useState<string | null>(() => getLastBackupAt(uid));
  const [busy, setBusy] = useState<"" | "local" | "onedrive">("");
  useEffect(() => {
    setAuto(getAutoBackupEnabled(uid));
    setLastAt(getLastBackupAt(uid));
  }, [uid]);

  const toggleAuto = (v: boolean) => {
    setAuto(v);
    setAutoBackupEnabled(uid, v);
  };

  const run = async (mode: "local" | "onedrive") => {
    if (!uid || uid === "anon") {
      toast.error("로그인이 필요합니다.");
      return;
    }
    setBusy(mode);
    try {
      const { filename, size, uploaded } = await runBackup(uid, {
        download: true,
        uploadOneDrive: mode === "onedrive",
      });
      const kb = Math.round(size / 1024);
      toast.success(
        `백업 완료 (${kb}KB)` + (uploaded ? " · OneDrive 업로드 성공" : ""),
        { description: filename },
      );
      setLastAt(getLastBackupAt(uid));
    } catch (e) {
      toast.error("백업 실패", { description: String((e as Error)?.message ?? e) });
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="p-6 space-y-4 max-w-2xl">
      <div>
        <h2 className="font-semibold mb-1">엑셀 백업</h2>
        <p className="text-xs text-muted-foreground">
          업체·팀장·배송기록·휴무일·공제·단가표 등 모든 데이터를 한 파일(.xlsx)로 저장합니다.
          OneDrive 사용 시 <span className="font-mono">삼호정산표_백업/</span> 폴더에 함께 업로드됩니다.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button onClick={() => run("local")} disabled={busy !== ""}>
          {busy === "local" ? "백업 중…" : "지금 백업 다운로드"}
        </Button>
        <Button variant="secondary" onClick={() => run("onedrive")} disabled={busy !== ""}>
          {busy === "onedrive" ? "업로드 중…" : "다운로드 + OneDrive 업로드"}
        </Button>
      </div>
      <div className="flex items-center gap-3 pt-2 border-t">
        <Checkbox
          id="auto-backup"
          checked={auto}
          onCheckedChange={(v) => toggleAuto(!!v)}
        />
        <Label htmlFor="auto-backup" className="text-sm font-normal cursor-pointer">
          매일 첫 접속 시 자동 백업 (24시간 1회)
        </Label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        마지막 백업: {lastAt ? new Date(lastAt).toLocaleString() : "없음"}
      </p>
      <RestoreSection uid={uid} />
    </Card>
  );
}

// 기본 복구 대상 — 사용자가 언급한 4개 테이블
const DEFAULT_RESTORE = new Set(["companies", "team_leaders", "deliveries", "holidays"]);

function RestoreSection({ uid }: { uid: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<RestoreMode>("upsert");
  const [confirmText, setConfirmText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RestoreResult[] | null>(null);

  const onPick = async (f: File | null) => {
    if (!f) return;
    try {
      const p = await parseBackupFile(f);
      setParsed(p);
      setFilename(f.name);
      const init: Record<string, boolean> = {};
      for (const t of p.tables) init[t.table] = DEFAULT_RESTORE.has(t.table);
      setSelected(init);
      setMode("upsert");
      setConfirmText("");
      setResults(null);
      setOpen(true);
    } catch (e) {
      toast.error("백업 파일 오류", { description: (e as Error).message });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const totalSelected = parsed
    ? parsed.tables.filter((t) => selected[t.table]).reduce((s, t) => s + t.rows.length, 0)
    : 0;

  // 선택 변경 시 즉시 재검증
  const validation: RestoreValidationResult | null = parsed
    ? validateBackupForRestore(
        parsed,
        Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
      )
    : null;

  const canRun = (() => {
    if (!parsed || busy) return false;
    if (!Object.values(selected).some(Boolean)) return false;
    if (mode === "replace" && confirmText.trim() !== "REPLACE") return false;
    if (validation && !validation.ok) return false;
    return true;
  })();

  const run = async () => {
    if (!parsed || !uid || uid === "anon") {
      toast.error("로그인이 필요합니다.");
      return;
    }
    if (validation && !validation.ok) {
      toast.error("복구 차단", {
        description: `금지 규칙 ${validation.errors.length}건 위반 — 백업 파일을 점검하세요.`,
      });
      return;
    }
    const tables = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    setBusy(true);
    setResults(null);
    try {
      const res = await restoreBackup(uid, parsed, tables, mode);
      setResults(res);

      const okSheets = res.filter((r) => !r.error && r.skipped === 0);
      const partialSheets = res.filter((r) => !r.error && r.skipped > 0);
      const failSheets = res.filter((r) => r.error);

      const totalInserted = res.reduce((s, r) => s + r.inserted, 0);
      const totalDeleted = res.reduce((s, r) => s + r.deleted, 0);
      const totalSkipped = res.reduce((s, r) => s + r.skipped, 0);
      const totalRows = res.reduce((s, r) => s + r.total, 0);

      if (failSheets.length === 0 && partialSheets.length === 0) {
        toast.success(`복구 완료 · ${okSheets.length}개 시트 · ${totalInserted.toLocaleString()}건 적용`, {
          description:
            mode === "replace"
              ? `삭제 ${totalDeleted.toLocaleString()}건 · 적용 ${totalInserted.toLocaleString()}건 / ${totalRows.toLocaleString()}건`
              : `병합 적용 ${totalInserted.toLocaleString()}건 / ${totalRows.toLocaleString()}건`,
          duration: 6000,
        });
      } else if (failSheets.length === 0) {
        toast.warning(`복구 완료 · 일부 배치 실패`, {
          description: `성공 ${totalInserted.toLocaleString()}건 · 건너뛴 ${totalSkipped.toLocaleString()}건 · ${partialSheets.length}개 시트`,
          duration: 8000,
        });
      } else {
        toast.error(`복구 중 오류 발생 · ${failSheets.length}개 시트 실패`, {
          description: `성공 ${okSheets.length + partialSheets.length}개 · 실패 ${failSheets.length}개 · 건너뛴 ${totalSkipped.toLocaleString()}건`,
          duration: 8000,
        });
      }
    } catch (e) {
      toast.error("복구 실패", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-3 border-t space-y-2">
      <h3 className="font-semibold text-sm">엑셀 백업 불러오기 (복구)</h3>
      <p className="text-xs text-muted-foreground">
        이전에 저장한 <span className="font-mono">.xlsx</span> 백업 파일을 선택하면 시트별 데이터를
        검토 후 복구할 수 있습니다.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        백업 파일 선택…
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>백업 복구 — {filename}</DialogTitle>
          </DialogHeader>

          {parsed && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {Object.keys(parsed.meta).length > 0 && (
                <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded">
                  {Object.entries(parsed.meta).slice(0, 6).map(([k, v]) => (
                    <div key={k}><span className="font-mono">{k}</span>: {v}</div>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">복구할 시트 선택</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {parsed.tables.map((t) => {
                    const known = RESTORABLE_TABLES.some((r) => r.table === t.table);
                    return (
                      <label
                        key={t.table}
                        className="flex items-center gap-2 text-sm border rounded px-2 py-1.5 cursor-pointer hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={!!selected[t.table]}
                          onCheckedChange={(v) =>
                            setSelected((s) => ({ ...s, [t.table]: !!v }))
                          }
                          disabled={!known || t.rows.length === 0}
                        />
                        <span className="flex-1">
                          {t.sheet}
                          {!known && <span className="text-destructive ml-1">(미지원)</span>}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {t.rows.length}건
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">복구 방식</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={`border rounded p-2 cursor-pointer text-sm ${mode === "upsert" ? "border-primary bg-primary/5" : ""}`}>
                    <input
                      type="radio"
                      name="restore-mode"
                      className="mr-2"
                      checked={mode === "upsert"}
                      onChange={() => setMode("upsert")}
                    />
                    <span className="font-medium">병합 (권장)</span>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      기존 데이터 유지, 동일 ID는 덮어씁니다.
                    </div>
                  </label>
                  <label className={`border rounded p-2 cursor-pointer text-sm ${mode === "replace" ? "border-destructive bg-destructive/5" : ""}`}>
                    <input
                      type="radio"
                      name="restore-mode"
                      className="mr-2"
                      checked={mode === "replace"}
                      onChange={() => setMode("replace")}
                    />
                    <span className="font-medium text-destructive">전체 교체 (위험)</span>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      선택한 시트의 내 데이터를 모두 삭제 후 재삽입합니다.
                    </div>
                  </label>
                </div>
              </div>

              {mode === "replace" && (
                <div className="space-y-1 p-2 border border-destructive/40 rounded bg-destructive/5">
                  <Label className="text-xs text-destructive">
                    확인을 위해 <span className="font-mono">REPLACE</span> 를 입력하세요
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="REPLACE"
                  />
                </div>
              )}

              {validation && validation.issues.length > 0 && (
                <div
                  className={
                    "text-xs space-y-1 border rounded p-2 " +
                    (validation.ok
                      ? "border-yellow-500/40 bg-yellow-500/5"
                      : "border-destructive bg-destructive/5")
                  }
                >
                  <div className={"font-semibold " + (validation.ok ? "" : "text-destructive")}>
                    {validation.ok
                      ? `경고 ${validation.warnings.length}건 — 진행 가능`
                      : `금지 규칙 위반 ${validation.errors.length}건 — 복구 차단`}
                  </div>
                  {validation.errors.map((i, idx) => (
                    <div key={`e-${idx}`} className="text-destructive">
                      • {i.message}
                      {i.detail && <span className="opacity-70"> — {i.detail}</span>}
                    </div>
                  ))}
                  {validation.warnings.map((i, idx) => (
                    <div key={`w-${idx}`} className="text-yellow-700 dark:text-yellow-400">
                      • {i.message}
                      {i.detail && <span className="opacity-70"> — {i.detail}</span>}
                    </div>
                  ))}
                  {!validation.ok && (
                    <div className="pt-1 text-[11px] text-destructive">
                      위 규칙을 통과해야 복구를 실행할 수 있습니다. 백업 파일을 점검 후 다시 시도하세요.
                    </div>
                  )}
                </div>
              )}

              {results && <RestoreResultPanel results={results} mode={mode} />}
            </div>
          )}

          <DialogFooter className="flex-row justify-between items-center gap-2">
            <div className="text-xs text-muted-foreground">
              선택된 행: {totalSelected.toLocaleString()}건
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                닫기
              </Button>
              <Button
                onClick={run}
                disabled={!canRun}
                variant={mode === "replace" ? "destructive" : "default"}
              >
                {busy ? "복구 중…" : mode === "replace" ? "전체 교체 실행" : "병합 복구 실행"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}



function RestoreResultPanel({
  results,
  mode,
}: {
  results: RestoreResult[];
  mode: RestoreMode;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (table: string) =>
    setExpanded((s) => ({ ...s, [table]: !s[table] }));

  const totalRows = results.reduce((s, r) => s + r.total, 0);
  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
  const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
  const failCount = results.filter((r) => r.error || r.skipped > 0).length;
  const allOk = failCount === 0;

  return (
    <div className="space-y-2 border rounded p-3 bg-muted/20">
      <div className="flex items-center gap-2">
        {allOk ? (
          <CheckCircle2 className="w-4 h-4 text-green-600" />
        ) : (
          <AlertCircle className="w-4 h-4 text-amber-600" />
        )}
        <span className="text-sm font-semibold">
          복구 결과 {allOk ? "· 전체 성공" : `· ${failCount}개 시트 이슈`}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {totalInserted.toLocaleString()}건 적용 / {totalRows.toLocaleString()}건
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-green-50 dark:bg-green-950/30 rounded p-2">
          <div className="text-xs text-muted-foreground">적용</div>
          <div className="text-base font-bold text-green-700 dark:text-green-400">
            {totalInserted.toLocaleString()}
          </div>
        </div>
        {mode === "replace" && (
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded p-2">
            <div className="text-xs text-muted-foreground">삭제</div>
            <div className="text-base font-bold text-blue-700 dark:text-blue-400">
              {totalDeleted.toLocaleString()}
            </div>
          </div>
        )}
        {totalSkipped > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/30 rounded p-2">
            <div className="text-xs text-muted-foreground">건너뜀</div>
            <div className="text-base font-bold text-amber-700 dark:text-amber-400">
              {totalSkipped.toLocaleString()}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1">
        {results.map((r) => {
          const ok = !r.error && r.skipped === 0;
          const hasErrors = !!r.error || (r.batchErrors && r.batchErrors.length > 0);
          return (
            <div key={r.table} className="border rounded bg-background">
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
                onClick={() => toggle(r.table)}
              >
                {ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                ) : hasErrors ? (
                  <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                )}
                <span className="text-sm flex-1">{r.sheet}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {r.inserted.toLocaleString()}/{r.total.toLocaleString()}건
                </span>
                {expanded[r.table] ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
              {expanded[r.table] && (
                <div className="px-2 pb-2 space-y-1 text-xs">
                  <div className="grid grid-cols-3 gap-1 text-center">
                    <div>적용: <span className="font-medium">{r.inserted}</span></div>
                    {mode === "replace" && <div>삭제: <span className="font-medium">{r.deleted}</span></div>}
                    {r.skipped > 0 && <div>건너뜀: <span className="font-medium text-amber-700">{r.skipped}</span></div>}
                  </div>
                  {r.error && (
                    <div className="text-destructive bg-destructive/5 rounded px-2 py-1">
                      {r.error}
                    </div>
                  )}
                  {r.batchErrors && r.batchErrors.length > 0 && (
                    <div className="space-y-0.5">
                      {r.batchErrors.map((be, idx) => (
                        <div key={idx} className="text-destructive/90">
                          · 배치 {be.batchIndex} ({be.count}건): {be.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompaniesTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Company[]>([]);
  const [name, setName] = useState("");
  const [leaders, setLeadersList] = useState<{ id: string; name: string }[]>([]);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupGroups, setDupGroups] = useState<Company[][]>([]);
  const [dupSel, setDupSel] = useState<Record<string, { checked: Set<string>; canonical: string | null }>>({});
  const [merging, setMerging] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualChecked, setManualChecked] = useState<Set<string>>(new Set());
  const [manualCanonical, setManualCanonical] = useState<string | null>(null);
  const [manualFilter, setManualFilter] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{
    group: Company[];
    canonical: Company;
    others: Company[];
    deliveries: any[];
    deliveriesTotal: number;
    prices: any[];
    pricesTotal: number;
    loading: boolean;
  } | null>(null);

  const load = async () => {
    const [{ data }, { data: ls }] = await Promise.all([
      supabase.from("companies").select("*").order("name"),
      supabase.from("team_leaders").select("id,name").eq("active", true).order("name"),
    ]);
    setRows((data as Company[]) || []);
    setLeadersList((ls as any) || []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim() || !user) return;
    const { error } = await supabase.from("companies").insert({ user_id: user.id, name: name.trim() });
    if (error) toast.error(error.message); else { setName(""); load(); }
  };

  const update = async (id: string, patch: Partial<Company>) => {
    const { error } = await supabase.from("companies").update(patch).eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  // 거부팀장 선택 시 같은 업체 내 중복 검사 후 저장.
  const setRejected = async (r: Company, slot: 1 | 2 | 3, value: string | null) => {
    const cur = {
      1: r.rejected_leader_id,
      2: r.rejected_leader_id_2,
      3: r.rejected_leader_id_3,
    } as Record<1 | 2 | 3, string | null>;
    cur[slot] = value;
    const picked = [cur[1], cur[2], cur[3]].filter(Boolean) as string[];
    if (new Set(picked).size !== picked.length) {
      toast.error("같은 거부팀장이 중복 등록되었습니다.");
      return;
    }
    const col =
      slot === 1 ? "rejected_leader_id" :
      slot === 2 ? "rejected_leader_id_2" :
      "rejected_leader_id_3";
    await update(r.id, { [col]: value } as any);
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("companies").delete().eq("id", id);
    load();
  };

  // 업체명 정규화: 공백/괄호/특수문자 제거, 소문자
  const normalize = (s: string) =>
    (s || "").toLowerCase().replace(/[\s\(\)\[\]\-_.,/\\·•:;'"`]+/g, "");

  // Levenshtein 거리
  const lev = (a: string, b: string) => {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
      let prev = dp[0];
      dp[0] = j;
      for (let i = 1; i <= a.length; i++) {
        const tmp = dp[i];
        dp[i] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[i], dp[i - 1]) + 1;
        prev = tmp;
      }
    }
    return dp[a.length];
  };
  // 유사도 (0~1)
  const similarity = (a: string, b: string) => {
    const A = normalize(a), B = normalize(b);
    if (!A || !B) return 0;
    const m = Math.max(A.length, B.length);
    return 1 - lev(A, B) / m;
  };

  const detectDups = () => {
    const map = new Map<string, Company[]>();
    for (const r of rows) {
      const k = normalize(r.name);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    const groups = Array.from(map.values()).filter((g) => g.length > 1);
    setDupGroups(groups);
    setDupSel(initSel(groups));
    setDupOpen(true);
    if (groups.length === 0) toast.success("중복된 업체가 없습니다.");
  };

  // 그룹별 선택 상태 초기화: 모두 체크 + 첫 번째를 기준
  const initSel = (groups: Company[][]) => {
    const out: Record<string, { checked: Set<string>; canonical: string | null }> = {};
    groups.forEach((g, i) => {
      const key = groupKey(g, i);
      out[key] = { checked: new Set(g.map((c) => c.id)), canonical: g[0]?.id || null };
    });
    return out;
  };
  const groupKey = (g: Company[], i: number) => `${i}:${g.map((c) => c.id).join(",")}`;
  const toggleDupCheck = (key: string, id: string) => {
    setDupSel((prev) => {
      const cur = prev[key] || { checked: new Set<string>(), canonical: null };
      const next = new Set(cur.checked);
      if (next.has(id)) next.delete(id); else next.add(id);
      let canonical = cur.canonical;
      if (canonical && !next.has(canonical)) canonical = null;
      return { ...prev, [key]: { checked: next, canonical } };
    });
  };
  const setDupCanonical = (key: string, id: string) => {
    setDupSel((prev) => {
      const cur = prev[key] || { checked: new Set<string>([id]), canonical: id };
      const next = new Set(cur.checked);
      next.add(id);
      return { ...prev, [key]: { checked: next, canonical: id } };
    });
  };
  const skipDupGroup = (g: Company[]) => {
    setDupGroups((prev) => prev.filter((x) => x !== g));
  };
  const previewSelected = async (g: Company[], key: string) => {
    const sel = dupSel[key];
    if (!sel || !sel.canonical) { toast.error("기준 업체를 선택해 주세요."); return; }
    const picked = g.filter((c) => sel.checked.has(c.id));
    if (picked.length < 2) { toast.error("2개 이상 선택해 주세요."); return; }
    if (!picked.some((c) => c.id === sel.canonical)) { toast.error("기준 업체를 선택 항목에 포함해 주세요."); return; }
    await openPreview(picked, sel.canonical);
  };

  // 유사 이름 검사: 임계값 이상 유사한 업체끼리 묶기 (Union-Find)
  const detectSimilar = (threshold = 0.7) => {
    const n = rows.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (x: number, y: number) => { const a = find(x), b = find(y); if (a !== b) parent[a] = b; };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = normalize(rows[i].name), b = normalize(rows[j].name);
        if (!a || !b) continue;
        if (a === b) { union(i, j); continue; }
        // 한쪽이 다른 쪽을 포함하면 유사로 간주
        if (a.includes(b) || b.includes(a)) { union(i, j); continue; }
        if (similarity(rows[i].name, rows[j].name) >= threshold) union(i, j);
      }
    }
    const buckets = new Map<number, Company[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!buckets.has(r)) buckets.set(r, []);
      buckets.get(r)!.push(rows[i]);
    }
    const groups = Array.from(buckets.values()).filter((g) => g.length > 1);
    setDupGroups(groups);
    setDupSel(initSel(groups));
    setDupOpen(true);
    if (groups.length === 0) toast.success("유사한 업체가 없습니다.");
    else toast.info(`유사 후보 ${groups.length}개 그룹을 찾았습니다.`);
  };

  // 한 그룹을 canonical로 통합
  const mergeGroup = async (group: Company[], canonicalId: string) => {
    if (!user) { toast.error("로그인이 필요합니다."); return; }
    const canonical = group.find((g) => g.id === canonicalId);
    if (!canonical) { toast.error("기준 업체를 찾을 수 없습니다."); return; }
    const others = group.filter((g) => g.id !== canonicalId);
    const otherIds = others.map((o) => o.id);
    if (otherIds.length === 0) { toast.error("통합할 대상이 없습니다."); return; }
    if (otherIds.includes(canonical.id)) { toast.error("기준 업체가 대상에 포함되어 있습니다."); return; }
    setMerging(true);
    try {
      // 1) deliveries 재할당
      const { error: e1 } = await supabase
        .from("deliveries")
        .update({ company_id: canonical.id, company_name: canonical.name })
        .in("company_id", otherIds);
      if (e1) throw e1;
      // 2) 이름 기반 deliveries (company_id null 인 경우 대비)
      const otherNames = others.map((o) => o.name);
      if (otherNames.length > 0) {
        const { error: e2 } = await supabase
          .from("deliveries")
          .update({ company_id: canonical.id, company_name: canonical.name })
          .is("company_id", null)
          .in("company_name", otherNames);
        if (e2) throw e2;
      }
      // 3) price_list 재할당
      const { error: ep } = await supabase
        .from("price_list")
        .update({ company_id: canonical.id, company_name: canonical.name })
        .in("company_id", otherIds);
      if (ep) throw ep;
      // 3.5) 검증: 옮겨지지 않은 잔여 행이 있으면 중단(데이터 손실 방지)
      const [{ count: remDel }, { count: remPrice }] = await Promise.all([
        supabase.from("deliveries").select("id", { count: "exact", head: true }).in("company_id", otherIds),
        supabase.from("price_list").select("id", { count: "exact", head: true }).in("company_id", otherIds),
      ]);
      if ((remDel || 0) > 0 || (remPrice || 0) > 0) {
        throw new Error(`잔여 데이터(배송 ${remDel || 0}건 / 단가 ${remPrice || 0}건)가 남아 통합을 중단했습니다.`);
      }
      // 4) 중복 업체 삭제
      const { error: e3 } = await supabase.from("companies").delete().in("id", otherIds);
      if (e3) throw e3;
      toast.success(`${others.length}건을 "${canonical.name}"(으)로 통합했습니다.`);
      await load();
      // 그룹 갱신
      setDupGroups((prev) => prev.filter((g) => g !== group));
    } catch (err: any) {
      toast.error("통합 실패: " + (err?.message || String(err)));
    } finally {
      setMerging(false);
    }
  };

  // 통합 전 미리보기: 옮겨질 배송/단가 데이터를 조회
  const openPreview = async (group: Company[], canonicalId: string) => {
    const canonical = group.find((g) => g.id === canonicalId);
    if (!canonical) return;
    const others = group.filter((g) => g.id !== canonicalId);
    const otherIds = others.map((o) => o.id);
    const otherNames = others.map((o) => o.name);
    setPreview({
      group, canonical, others,
      deliveries: [], deliveriesTotal: 0, prices: [], pricesTotal: 0,
      loading: true,
    });
    try {
      // 배송: company_id 매칭 + (company_id null & 이름 매칭)
      const [byId, byName, priceRes] = await Promise.all([
        supabase
          .from("deliveries")
          .select("id,date,company_name,leader1_name,customer_name,item,metro_fee,note_amount,regional_fee,cod_amount", { count: "exact" })
          .in("company_id", otherIds.length ? otherIds : ["00000000-0000-0000-0000-000000000000"])
          .order("date", { ascending: false })
          .limit(50),
        otherNames.length
          ? supabase
              .from("deliveries")
              .select("id,date,company_name,leader1_name,customer_name,item,metro_fee,note_amount,regional_fee,cod_amount", { count: "exact" })
              .is("company_id", null)
              .in("company_name", otherNames)
              .order("date", { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [], count: 0 } as any),
        supabase
          .from("price_list")
          .select("id,company_name,region_type,region_detail,item,spec,metro_fee,note_amount,regional_fee,cod_default", { count: "exact" })
          .in("company_id", otherIds.length ? otherIds : ["00000000-0000-0000-0000-000000000000"])
          .order("company_name")
          .limit(50),
      ]);
      const dels = [...((byId.data as any[]) || []), ...((byName.data as any[]) || [])].slice(0, 50);
      const delTotal = (byId.count || 0) + (byName.count || 0);
      setPreview({
        group, canonical, others,
        deliveries: dels,
        deliveriesTotal: delTotal,
        prices: (priceRes.data as any[]) || [],
        pricesTotal: priceRes.count || 0,
        loading: false,
      });
    } catch (err: any) {
      toast.error("미리보기 실패: " + (err?.message || String(err)));
      setPreview(null);
    }
  };

  const confirmMerge = async () => {
    if (!preview) return;
    const { group, canonical } = preview;
    setPreview(null);
    await mergeGroup(group, canonical.id);
  };

  const mergeAll = async () => {
    if (!confirm(`총 ${dupGroups.length}개 그룹을 자동 통합합니다. 진행할까요?\n(각 그룹에서 가장 먼저 등록된 업체를 기준으로 합칩니다)`)) return;
    for (const g of [...dupGroups]) {
      // canonical = 가장 먼저 등록된(이름 알파벳 우선) → 여기선 단순히 첫 번째
      const canonical = g[0];
      await mergeGroup(g, canonical.id);
    }
  };

  // 지정 통합: 사용자가 직접 통합할 업체를 선택
  const openManual = () => {
    setManualChecked(new Set());
    setManualCanonical(null);
    setManualFilter("");
    setManualOpen(true);
  };
  const toggleManual = (id: string) => {
    setManualChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (manualCanonical === id) setManualCanonical(null);
      } else next.add(id);
      return next;
    });
  };
  const proceedManual = async () => {
    const ids = Array.from(manualChecked);
    if (ids.length < 2) { toast.error("2개 이상 선택해 주세요."); return; }
    if (!manualCanonical || !manualChecked.has(manualCanonical)) {
      toast.error("기준 업체를 선택해 주세요.");
      return;
    }
    const group = rows.filter((r) => manualChecked.has(r.id));
    setManualOpen(false);
    await openPreview(group, manualCanonical);
  };

  // 정렬 우선순위: 1) 계산서 발행, 2) 착불 있음, 3) 나머지. 같은 그룹 내 이름순.
  const sortedRows = [...rows].sort((a, b) => {
    const rank = (c: Company) => (c.issues_invoice ? 0 : c.has_cod ? 1 : 2);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (a.name || "").localeCompare(b.name || "", "ko");
  });
  const filteredRows = sortedRows.filter((r) => {
    if (!search.trim()) return true;
    return (r.name || "").toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-0 flex-1 basis-[160px]" placeholder="업체명" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button onClick={add}><Plus className="h-4 w-4 mr-1" />추가</Button>
          <Button variant="outline" onClick={detectDups}>중복 검사</Button>
          <Button variant="outline" onClick={() => detectSimilar(0.7)}>유사 이름 검사</Button>
          <Button variant="outline" onClick={openManual}>지정 통합</Button>
        </div>
        <div>
          <Input placeholder="업체 검색 (업체명 일부 입력)" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full" />
        </div>
        <div className="text-xs text-muted-foreground">
          전체 {rows.length}개 업체{search.trim() ? ` · 검색 결과 ${filteredRows.length}개` : ""}
        </div>
      </div>
      <div className="overflow-x-auto [&_th]:text-center [&_td]:text-center [&_input]:text-center [&_[role=combobox]]:justify-center">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">연번</TableHead>
            <TableHead>업체명</TableHead>
            <TableHead>계산서</TableHead>
            <TableHead>계좌번호</TableHead>
            <TableHead>정산주기</TableHead>
            <TableHead>거부팀장1</TableHead>
            <TableHead>거부팀장2</TableHead>
            <TableHead>거부팀장3</TableHead>
            <TableHead>착불유무</TableHead>
            <TableHead>사용</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRows.map((r, idx) => (
            <TableRow key={r.id}>
              <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
              <TableCell><Input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })} /></TableCell>
              <TableCell><Checkbox checked={r.issues_invoice} onCheckedChange={(v) => update(r.id, { issues_invoice: !!v })} /></TableCell>
              <TableCell>
                <Input
                  className="w-44"
                  placeholder="예: 신한 110-123-456"
                  defaultValue={r.account_number || ""}
                  onBlur={(e) => e.target.value !== (r.account_number || "") && update(r.id, { account_number: e.target.value || null } as any)}
                />
              </TableCell>
              <TableCell>
                <Select
                  value={r.settlement_cycle || "biweekly"}
                  onValueChange={(v) => update(r.id, { settlement_cycle: v } as any)}
                >
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="biweekly">보름</SelectItem>
                    <SelectItem value="monthly">한달</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              {([1, 2, 3] as const).map((slot) => {
                const val =
                  slot === 1 ? r.rejected_leader_id :
                  slot === 2 ? r.rejected_leader_id_2 :
                  r.rejected_leader_id_3;
                return (
                  <TableCell key={slot}>
                    <Select
                      value={val || "__none__"}
                      onValueChange={(v) => setRejected(r, slot, v === "__none__" ? null : v)}
                    >
                      <SelectTrigger className="w-32"><SelectValue placeholder="없음" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">없음</SelectItem>
                        {leaders.map((l) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                );
              })}
              <TableCell><Checkbox checked={!!r.has_cod} onCheckedChange={(v) => update(r.id, { has_cod: !!v } as any)} /></TableCell>
              <TableCell><Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} /></TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
          {filteredRows.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">{search.trim() ? "검색 결과가 없습니다" : "등록된 업체가 없습니다"}</TableCell></TableRow>}
        </TableBody>
      </Table>
      </div>
      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>업체 중복 검사 결과</DialogTitle>
          </DialogHeader>
          {dupGroups.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">중복된 업체가 없습니다.</div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="text-xs text-muted-foreground">
                각 그룹에서 통합할 업체만 체크하고, 기준 업체를 선택하세요. 선택한 업체들의 모든 배송/단가 데이터가 기준 업체로 옮겨집니다. 통합하지 않을 그룹은 "통합 안 함"을 누르세요.
              </div>
              {dupGroups.map((g, gi) => {
                const key = groupKey(g, gi);
                const sel = dupSel[key] || { checked: new Set<string>(), canonical: null };
                return (
                  <Card key={key} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">그룹 {gi + 1} · {g.length}개</div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" disabled={merging} onClick={() => skipDupGroup(g)}>
                          통합 안 함
                        </Button>
                        <Button size="sm" disabled={merging} onClick={() => previewSelected(g, key)}>
                          선택 통합 (미리보기)
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-1 text-sm items-center">
                      <div className="text-[11px] text-muted-foreground">통합</div>
                      <div className="text-[11px] text-muted-foreground">기준</div>
                      <div className="text-[11px] text-muted-foreground">업체명</div>
                      {g.map((c) => (
                        <React.Fragment key={c.id}>
                          <Checkbox
                            checked={sel.checked.has(c.id)}
                            onCheckedChange={() => toggleDupCheck(key, c.id)}
                          />
                          <input
                            type="radio"
                            name={`canonical-${key}`}
                            checked={sel.canonical === c.id}
                            onChange={() => setDupCanonical(key, c.id)}
                            className="h-4 w-4 cursor-pointer"
                          />
                          <div className="flex-1 truncate">
                            <span className="font-medium">{c.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {c.active ? "사용중" : "미사용"} · {c.issues_invoice ? "계산서" : "노계산서"}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
          <DialogFooter>
            {dupGroups.length > 0 && (
              <Button onClick={mergeAll} disabled={merging}>전체 자동 통합</Button>
            )}
            <Button variant="outline" onClick={() => setDupOpen(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>통합 미리보기</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div>
                  기준 업체: <span className="font-bold">{preview.canonical.name}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  통합 대상({preview.others.length}개): {preview.others.map((o) => o.name).join(", ")}
                </div>
                <div className="mt-2 flex gap-4 text-xs">
                  <span>배송 기록: <b>{preview.loading ? "…" : preview.deliveriesTotal}</b>건 이동</span>
                  <span>단가표: <b>{preview.loading ? "…" : preview.pricesTotal}</b>건 이동</span>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  배송 기록 미리보기 (최대 50건)
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        {["날짜", "현재업체명", "팀장", "고객", "품목", "수도권", "비고금액", "지방", "착불"].map((h) => (
                          <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.deliveries.map((d) => (
                        <tr key={d.id} className="border-t">
                          <td className="px-2 py-1 whitespace-nowrap">{d.date}</td>
                          <td className="px-2 py-1">{d.company_name}</td>
                          <td className="px-2 py-1">{d.leader1_name || ""}</td>
                          <td className="px-2 py-1">{d.customer_name || ""}</td>
                          <td className="px-2 py-1 truncate max-w-[160px]">{d.item || ""}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(d.metro_fee || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(d.note_amount || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(d.regional_fee || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(d.cod_amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      {!preview.loading && preview.deliveries.length === 0 && (
                        <tr><td colSpan={9} className="px-2 py-3 text-center text-muted-foreground">이동할 배송 기록이 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  단가표 미리보기 (최대 50건)
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        {["현재업체명", "권역", "상세", "품목", "규격", "수도권", "비고금액", "지방", "착불기본"].map((h) => (
                          <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.prices.map((p) => (
                        <tr key={p.id} className="border-t">
                          <td className="px-2 py-1">{p.company_name}</td>
                          <td className="px-2 py-1">{p.region_type || ""}</td>
                          <td className="px-2 py-1">{p.region_detail || ""}</td>
                          <td className="px-2 py-1 truncate max-w-[160px]">{p.item || ""}</td>
                          <td className="px-2 py-1">{p.spec || ""}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(p.metro_fee || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(p.note_amount || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(p.regional_fee || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(p.cod_default || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      {!preview.loading && preview.prices.length === 0 && (
                        <tr><td colSpan={9} className="px-2 py-3 text-center text-muted-foreground">이동할 단가표가 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground">
                실행하면 위 데이터의 업체가 <b>{preview.canonical.name}</b>(으)로 변경되고, 기존 중복 업체 {preview.others.length}개는 삭제됩니다. 되돌릴 수 없습니다.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={merging}>취소</Button>
            <Button onClick={confirmMerge} disabled={merging || !preview || preview.loading}>
              {merging ? "통합 중…" : "통합 실행"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="w-[95vw] max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>지정 통합</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              합칠 업체를 2개 이상 체크하고, 그중 <b>기준 업체</b>를 라디오로 선택하세요. 다음 화면에서 옮겨질 배송/단가를 미리 확인할 수 있습니다.
            </div>
            <Input
              placeholder="업체명 검색"
              value={manualFilter}
              onChange={(e) => setManualFilter(e.target.value)}
            />
            <div className="max-h-[50vh] overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs">
                  <tr>
                    <th className="px-2 py-1 w-10">선택</th>
                    <th className="px-2 py-1 w-16">기준</th>
                    <th className="px-2 py-1 text-left">업체명</th>
                    <th className="px-2 py-1">사용</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => !manualFilter || r.name.toLowerCase().includes(manualFilter.toLowerCase()))
                    .map((r) => {
                      const checked = manualChecked.has(r.id);
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="px-2 py-1 text-center">
                            <Checkbox checked={checked} onCheckedChange={() => toggleManual(r.id)} />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <input
                              type="radio"
                              name="manual-canonical"
                              disabled={!checked}
                              checked={manualCanonical === r.id}
                              onChange={() => setManualCanonical(r.id)}
                            />
                          </td>
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 text-center text-xs text-muted-foreground">
                            {r.active ? "사용중" : "미사용"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-muted-foreground">
              선택됨: {manualChecked.size}개 · 기준: {manualCanonical ? rows.find((r) => r.id === manualCanonical)?.name : "(미선택)"}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>취소</Button>
            <Button onClick={proceedManual} disabled={manualChecked.size < 2 || !manualCanonical}>
              미리보기로 진행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LeadersTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Leader[]>([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState<"all" | "metro" | "regional" | "none">("all");

  const load = async () => {
    // 입력순(생성일 오름차순)으로 정렬
    const { data } = await supabase
      .from("team_leaders")
      .select("*")
      .order("created_at", { ascending: true });
    setRows((data as Leader[]) || []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim() || !user) return;
    const { error } = await supabase.from("team_leaders").insert({ user_id: user.id, name: name.trim() });
    if (error) toast.error(error.message); else { setName(""); load(); }
  };

  const update = async (id: string, patch: Partial<Leader>) => {
    const { error } = await supabase.from("team_leaders").update(patch).eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("team_leaders").delete().eq("id", id);
    load();
  };

  const dupCounts = detectDuplicates(rows);

  const matchRegion = (r: Leader) => {
    if (regionFilter === "all") return true;
    const v = (r.region || "").trim();
    if (regionFilter === "none") return v === "";
    return v === regionFilter; // 'metro' | 'regional'
  };
  const matchSearch = (r: Leader) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    if ((r.name || "").toLowerCase().includes(q)) return true;
    const aliases = r.aliases || [];
    return aliases.some((a) => (a || "").toLowerCase().includes(q));
  };
  const filteredRows = rows
    .filter((r) => matchRegion(r) && matchSearch(r))
    .sort(compareLeadersByFeeAsc);

  const regionCounts = {
    all: rows.length,
    metro: rows.filter((r) => (r.region || "").trim() === "metro").length,
    regional: rows.filter((r) => (r.region || "").trim() === "regional").length,
    none: rows.filter((r) => !(r.region || "").trim()).length,
  };

  // 위치 변경 시 수수료 자동 보정:
  //  - 수도권으로 설정 → fee_rate_metro 가 0 이면 fee_rate_regional 값을 복사
  //  - 지방으로 설정   → fee_rate_regional 가 0 이면 fee_rate_metro 값을 복사
  const updateRegion = async (row: Leader, next: "metro" | "regional" | "") => {
    const patch: Partial<Leader> = { region: next || null } as any;
    const mr = Number(row.fee_rate_metro || 0);
    const rr = Number(row.fee_rate_regional || 0);
    if (next === "metro" && mr === 0 && rr > 0) (patch as any).fee_rate_metro = rr;
    if (next === "regional" && rr === 0 && mr > 0) (patch as any).fee_rate_regional = mr;
    await update(row.id, patch);
    if ((patch as any).fee_rate_metro !== undefined || (patch as any).fee_rate_regional !== undefined) {
      toast.success(`${row.name}: 위치 변경에 따라 수수료율을 자동 보정했습니다`);
    }
  };

  /** 별칭 1개만 허용 */
  const updateAlias = async (id: string, value: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const v = value.trim();
    const toSave = v ? [v] : [];
    const conflict = findAliasConflict(id, toSave, rows);
    if (conflict) { toast.error(conflict); load(); return; }
    await update(id, { aliases: toSave } as any);
  };

  const updateName = async (id: string, nextName: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const trimmed = nextName.trim();
    if (!trimmed) { toast.error("팀장명은 비울 수 없습니다"); load(); return; }
    const conflict = findDisplayNameConflict(id, trimmed, row.display_suffix || null, rows);
    if (conflict) { toast.error(conflict); load(); return; }
    await update(id, { name: trimmed });
  };

  const updateSuffix = async (id: string, nextSuffix: string | null) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const conflict = findDisplayNameConflict(id, row.name, nextSuffix, rows);
    if (conflict) { toast.error(conflict); load(); return; }
    await update(id, { display_suffix: nextSuffix } as any);
  };

  const [cleaning, setCleaning] = useState(false);

  /**
   * 기존 deliveries에서 별칭으로 저장된 팀장명을 찾아 정식 팀장명/ID로 통합.
   * - leaderN_id가 비었지만 leaderN_name이 별칭과 매칭되면 ID/이름 채움
   * - leaderN_id가 있으면 leaderN_name을 해당 팀장의 정식 이름으로 동기화
   */
  const cleanLeaderNames = async () => {
    if (!confirm("기존 기록의 팀장 이름을 정식 팀장명으로 통합합니다. 진행하시겠습니까?")) return;
    setCleaning(true);
    try {
      const matchable = rows;
      const byId = new Map(rows.map((l) => [l.id, l]));

      // 전체 deliveries 로드 (페이지네이션)
      const all: any[] = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await supabase
          .from("deliveries")
          .select("id,leader1_id,leader1_name,leader2_id,leader2_name,leader3_id,leader3_name")
          .range(from, from + page - 1);
        if (error) throw error;
        const chunk = data || [];
        all.push(...chunk);
        if (chunk.length < page) break;
      }

      let updated = 0, matched = 0, renamed = 0, ambiguous = 0;
      for (const r of all) {
        const patch: any = {};
        for (const slot of [1, 2, 3] as const) {
          const idKey = `leader${slot}_id` as const;
          const nameKey = `leader${slot}_name` as const;
          const curId: string | null = r[idKey];
          const curName: string | null = r[nameKey];
          if (curId) {
            const l = byId.get(curId);
            if (l && l.name && (curName || "").trim() !== l.name.trim()) {
              patch[nameKey] = l.name;
              renamed++;
            }
          } else if (curName && curName.trim()) {
            const hit = resolveLeaderName(curName, matchable);
            if (hit) {
              patch[idKey] = hit.id;
              patch[nameKey] = hit.name;
              matched++;
            } else {
              // 매칭 실패 / 동명이인 미해소 — 변환하지 않고 카운트만
              ambiguous++;
            }
          }
        }
        if (Object.keys(patch).length) {
          const { error } = await supabase.from("deliveries").update(patch).eq("id", r.id);
          if (!error) updated++;
        }
      }
      toast.success(
        `정리 완료: ${updated}건 업데이트 (별칭 매칭 ${matched} · 이름 동기화 ${renamed} · 미해소 ${ambiguous})`,
      );
    } catch (e: any) {
      toast.error("정리 실패: " + (e?.message || String(e)));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input placeholder="팀장명" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button onClick={add}><Plus className="h-4 w-4 mr-1" />추가</Button>
          <Button variant="outline" onClick={cleanLeaderNames} disabled={cleaning}>
            {cleaning ? "정리 중..." : "팀장 이름 정리"}
          </Button>
        </div>
        <div>
          <Input placeholder="팀장 검색 (이름 또는 별칭 일부 입력)" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full" />
        </div>
        <div className="text-xs text-muted-foreground">
          전체 {rows.length}명 팀장{search.trim() ? ` · 필터 결과 ${filteredRows.length}명` : ""}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        ‘팀장 이름 정리’: 기존 기록에서 별칭으로 저장된 팀장명을 정식 팀장명/ID로 통합합니다.
        별칭(예: 형주 → 강형주, 동석 → 신동석)이 등록되어 있어야 합니다.
      </div>
      <div className="overflow-x-auto [&_th]:text-center [&_td]:text-center [&_input]:text-center [&_[role=combobox]]:justify-center">
      <Table className="min-w-[1200px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">연번</TableHead>
            <TableHead>정식 팀장명</TableHead>
            <TableHead className="w-28">위치</TableHead>
            <TableHead className="min-w-[110px]">
              별칭(1개)
              <div className="text-[10px] text-amber-700 font-normal">거부기사 업체표시용</div>
            </TableHead>
            <TableHead>계산서</TableHead>
            <TableHead>수도권 수수료율</TableHead>
            <TableHead>지방 수수료율</TableHead>
            <TableHead>정산상태</TableHead>
            <TableHead>정산기사</TableHead>
            <TableHead>계좌번호</TableHead>
            <TableHead>사용여부</TableHead>
            <TableHead className="min-w-[120px]">최저보장</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRows.map((r, idx) => {
            const isDup = (dupCounts.get(r.name.trim()) ?? 0) > 1;
            const al = r.aliases || [];
            const needsAlias = r.is_rejected && !(al[0] || "").trim();
            const settleTarget = r.settle_to_id ? rows.find((x) => x.id === r.settle_to_id) : null;
            const isSpecial = r.is_rejected && !!settleTarget;
            const acctTrim = (r.account_number || "").trim();
            const acctMissing = r.issues_invoice && !acctTrim;
            const acctTooShort = !!acctTrim && acctTrim.replace(/\s/g, "").length < 8;
            const excludedNoTarget = (r.settle_status || "included") === "excluded" && !r.settle_to_id && !r.is_rejected;
            const minGuaranteeInvalid = r.min_guarantee_enabled && (!r.min_guarantee_amount || r.min_guarantee_amount <= 0);
            return (
            <TableRow key={r.id}>
              <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Input defaultValue={r.name} onBlur={(e) => e.target.value.trim() !== r.name && updateName(r.id, e.target.value)} />
                  {isDup && <span className="text-xs text-amber-600 whitespace-nowrap">동명이인</span>}
                </div>
                {isDup && <div className="text-xs text-muted-foreground mt-1">표시: {getDisplayName(r, rows)}</div>}
              </TableCell>
              <TableCell>
                <Select
                  value={(r.region || "") === "metro" ? "metro" : (r.region || "") === "regional" ? "regional" : "__none__"}
                  onValueChange={(v) => updateRegion(r, v === "__none__" ? "" : (v as "metro" | "regional"))}
                >
                  <SelectTrigger className="w-24"><SelectValue placeholder="미지정" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">미지정</SelectItem>
                    <SelectItem value="metro">수도권</SelectItem>
                    <SelectItem value="regional">지방</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  className={`w-28 ${needsAlias ? "border-destructive" : ""}`}
                  defaultValue={al[0] || ""}
                  placeholder={r.is_rejected ? "업체 표시명 (필수)" : "예: 동선"}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if ((v.trim() || "") !== (al[0] || "")) {
                      updateAlias(r.id, v);
                    }
                  }}
                />
                {needsAlias && (
                  <div className="text-[10px] text-destructive mt-1">거부기사 표시용 별칭 필요</div>
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={r.issues_invoice ? "yes" : "no"}
                  onValueChange={(v) => {
                    const next = v === "yes";
                    update(r.id, { issues_invoice: next } as any);
                    if (next && !acctTrim) toast.warning(`${r.name}: 계산서 발행 시 계좌번호가 필요합니다`);
                  }}
                >
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">발행</SelectItem>
                    <SelectItem value="no">미발행</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell><Input type="number" className="w-24" defaultValue={r.fee_rate_metro ?? 0} onBlur={(e) => update(r.id, { fee_rate_metro: Number(e.target.value) } as any)} /></TableCell>
              <TableCell><Input type="number" className="w-24" defaultValue={r.fee_rate_regional ?? 0} onBlur={(e) => update(r.id, { fee_rate_regional: Number(e.target.value) } as any)} /></TableCell>
              <TableCell>
                <Select
                  value={r.settle_status || "included"}
                  onValueChange={(v) => {
                    update(r.id, { settle_status: v } as any);
                    if (v === "excluded" && !r.settle_to_id && !r.is_rejected) {
                      toast.warning(`${r.name}: 정산제외 시 정산귀속 또는 거부 설정을 확인하세요`);
                    }
                  }}
                >
                  <SelectTrigger className={`w-28 ${excludedNoTarget ? "border-destructive" : ""}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="included">정산포함</SelectItem>
                    <SelectItem value="excluded">정산제외</SelectItem>
                  </SelectContent>
                </Select>
                {excludedNoTarget && <div className="text-[10px] text-destructive mt-1">귀속 미지정</div>}
              </TableCell>
              <TableCell>
                <Select value={r.settle_to_id || "none"} onValueChange={(v) => update(r.id, { settle_to_id: v === "none" ? null : v })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">본인</SelectItem>
                    {rows.filter((x) => x.id !== r.id).map((x) => <SelectItem key={x.id} value={x.id}>{getDisplayName(x, rows)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  className={`w-36 ${acctMissing ? "border-destructive" : ""}`}
                  defaultValue={r.account_number || ""}
                  placeholder="은행 000-000"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (r.account_number || null)) {
                      update(r.id, { account_number: v } as any);
                    }
                  }}
                />
                {acctMissing && <div className="text-[10px] text-destructive mt-1">계좌번호 필요</div>}
                {!acctMissing && acctTooShort && <div className="text-[10px] text-amber-600 mt-1">형식 확인</div>}
              </TableCell>
              <TableCell><Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} /></TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Checkbox
                    checked={r.min_guarantee_enabled}
                    onCheckedChange={(v) => {
                      const enabled = !!v;
                      update(r.id, { min_guarantee_enabled: enabled } as any);
                      if (enabled && (!r.min_guarantee_amount || r.min_guarantee_amount <= 0)) {
                        toast.warning(`${r.name}: 최저보장 금액을 입력하세요`);
                      }
                    }}
                  />
                  <Input
                    type="number"
                    className={`w-24 ${minGuaranteeInvalid ? "border-destructive" : ""}`}
                    disabled={!r.min_guarantee_enabled}
                    defaultValue={r.min_guarantee_amount ?? 0}
                    onBlur={(e) => {
                      let v = Number(e.target.value) || 0;
                      if (v < 0) {
                        toast.error(`${r.name}: 최저보장 금액은 0 이상이어야 합니다`);
                        e.target.value = String(r.min_guarantee_amount ?? 0);
                        return;
                      }
                      if (v !== (r.min_guarantee_amount ?? 0)) update(r.id, { min_guarantee_amount: v } as any);
                      if (r.min_guarantee_enabled && v <= 0) {
                        toast.warning(`${r.name}: 최저보장이 켜져 있지만 금액이 0 입니다`);
                      }
                    }}
                  />
                </div>
                {minGuaranteeInvalid && <div className="text-[10px] text-destructive mt-1">금액 입력 필요</div>}
              </TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
            );
          })}
          {filteredRows.length === 0 && <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-8">{(search.trim() || regionFilter !== "all") ? "검색 결과가 없습니다" : "등록된 팀장이 없습니다"}</TableCell></TableRow>}
        </TableBody>
      </Table>
      </div>
    </Card>
  );
}


type CommonDeduction = { id: string; label: string; amount: number; active: boolean; sort_order: number };

function CommonDeductionsTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<CommonDeduction[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("common_deductions")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) { toast.error("불러오기 실패: " + error.message); return; }
    let list = (data as CommonDeduction[]) || [];
    // 최초 진입 시 쓰레기비용 50,000 기본 시드
    if (list.length === 0 && user) {
      const { data: ins, error: e2 } = await supabase
        .from("common_deductions")
        .insert({ user_id: user.id, label: "쓰레기비용", amount: 50000, active: true, sort_order: 0 })
        .select()
        .single();
      if (!e2 && ins) list = [ins as CommonDeduction];
    }
    setRows(list);
  };
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const addRow = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("common_deductions")
      .insert({ user_id: user.id, label: "", amount: 0, active: true, sort_order: rows.length })
      .select()
      .single();
    if (error) { toast.error("추가 실패: " + error.message); return; }
    setRows([...rows, data as CommonDeduction]);
  };

  const update = (id: string, patch: Partial<CommonDeduction>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    const { error } = await supabase.from("common_deductions").delete().eq("id", id);
    if (error) { toast.error("삭제 실패: " + error.message); return; }
    setRows(rows.filter((r) => r.id !== id));
  };

  const saveAll = async () => {
    setLoading(true);
    for (const r of rows) {
      await supabase
        .from("common_deductions")
        .update({ label: r.label, amount: Number(r.amount) || 0, active: r.active, sort_order: r.sort_order })
        .eq("id", r.id);
    }
    setLoading(false);
    toast.success("저장 완료");
    load();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">공통 공제 관리</h3>
          <p className="text-sm text-muted-foreground">모든 정산대상 팀장에게 자동 적용됩니다. (예: 쓰레기비용 50,000)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />항목 추가</Button>
          <Button size="sm" onClick={saveAll} disabled={loading}>저장</Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>공제내용</TableHead>
            <TableHead className="w-40 text-right">공제금액</TableHead>
            <TableHead className="w-24 text-center">적용</TableHead>
            <TableHead className="w-16"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Input value={r.label} onChange={(e) => update(r.id, { label: e.target.value })} placeholder="예: 쓰레기비용" />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  className="text-right"
                  value={r.amount}
                  onChange={(e) => update(r.id, { amount: Number(e.target.value) || 0 })}
                />
              </TableCell>
              <TableCell className="text-center">
                <Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} />
              </TableCell>
              <TableCell>
                <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">공통 공제 항목이 없습니다</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

// ============================================================
// 지역(수도권/지방) 자동 분류 키워드 관리
// ============================================================
function RegionKeywordsTab() {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const [keywords, setKeywords] = useState<string[]>(() => loadMetroKeywords(uid));
  const [text, setText] = useState<string>(() => loadMetroKeywords(uid).join(", "));
  const [test, setTest] = useState("");

  useEffect(() => {
    const next = loadMetroKeywords(uid);
    setKeywords(next);
    setText(next.join(", "));
  }, [uid]);

  const parse = (raw: string) =>
    Array.from(
      new Set(
        raw
          .split(/[\n,]+/g)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      )
    );

  const save = () => {
    const list = parse(text);
    if (list.length === 0) { toast.error("키워드가 비어 있습니다"); return; }
    saveMetroKeywords(uid, list);
    setKeywords(list);
    setText(list.join(", "));
    toast.success(`저장됨 (${list.length}개 키워드)`);
  };

  const resetDefault = () => {
    if (!confirm("기본값으로 되돌리시겠습니까? (저장된 키워드가 사라집니다)")) return;
    saveMetroKeywords(uid, [...DEFAULT_METRO_KEYWORDS]);
    setKeywords([...DEFAULT_METRO_KEYWORDS]);
    setText(DEFAULT_METRO_KEYWORDS.join(", "));
    toast.success("기본 키워드로 복원되었습니다");
  };

  const removeKw = (kw: string) => {
    const next = keywords.filter((k) => k !== kw);
    setKeywords(next);
    setText(next.join(", "));
    saveMetroKeywords(uid, next);
  };

  const testResult = test.trim() ? classifyRegion(test, keywords) : null;

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-1">
        <div className="text-sm font-medium">수도권 키워드 (자동 지역 분류)</div>
        <div className="text-xs text-muted-foreground">
          배송지 텍스트에 아래 키워드 중 하나라도 포함되면 <b>수도권(metro)</b>으로 분류됩니다.
          그 외에는 <b>지방(regional)</b>으로 처리됩니다.
          쉼표(,) 또는 줄바꿈으로 구분하세요. (대소문자/공백 자동 정리, 중복 제거)
        </div>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[160px] font-mono text-sm"
        placeholder="예: 서울, 경기, 인천, 강남구, 분당, ..."
      />
      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={save}>저장</Button>
        <Button variant="outline" onClick={resetDefault}>기본값 복원</Button>
        <div className="text-xs text-muted-foreground ml-auto">
          현재 저장된 키워드: <b>{keywords.length}</b>개
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">분류 테스트</div>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="배송지 주소를 입력해 분류 결과를 확인하세요"
            value={test}
            onChange={(e) => setTest(e.target.value)}
            className="flex-1"
          />
          {testResult && (
            <span className={`text-sm font-semibold px-2 py-1 rounded ${
              testResult === "metro" ? "bg-primary/10 text-primary" : "bg-muted text-foreground"
            }`}>
              {testResult === "metro" ? "수도권" : testResult === "regional" ? "지방" : "미확인"}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">등록된 키워드 ({keywords.length})</div>
        <div className="flex flex-wrap gap-1.5 max-h-[280px] overflow-auto p-2 border rounded">
          {keywords.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
            >
              {k}
              <button
                onClick={() => removeKw(k)}
                className="text-muted-foreground hover:text-destructive"
                title="삭제"
              >
                ×
              </button>
            </span>
          ))}
          {keywords.length === 0 && (
            <div className="text-xs text-muted-foreground">등록된 키워드가 없습니다</div>
          )}
        </div>
      </div>
    </Card>
  );
}
function ShareAppTab() {
  const [url, setUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.origin);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("URL이 복사되었습니다");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("복사에 실패했습니다");
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "삼호정산표",
          text: "삼호정산표 앱을 확인해보세요",
          url,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toast.error("공유에 실패했습니다");
        }
      }
    } else {
      handleCopy();
    }
  };

  const isPreview = url.includes("preview");

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-6 space-y-5">
        <div>
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <Globe className="h-4 w-4" />
            앱 URL 공유
          </h2>
          <p className="text-xs text-muted-foreground">
            이 주소를 복사해서 다른 사람과 공유할 수 있습니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={url}
            readOnly
            className="flex-1 font-mono text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleCopy}
            className={copied ? "text-green-600 border-green-600" : ""}
            title="URL 복사"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            onClick={handleShare}
            className="gap-1.5"
          >
            <Share2 className="h-4 w-4" />
            공유
          </Button>
        </div>

        {isPreview && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-300">
            <p className="font-medium mb-1">미리보기 URL입니다</p>
            <p className="text-xs">
              공식 공개 URL을 사용하려면 우측 상단의 <strong>Publish</strong> 버튼으로 게시 후,
              생성된 <strong>lovable.app</strong> 주소로 접속해서 복사하세요.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
