import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmt } from "@/lib/format";
import { loadCompanySettings } from "@/lib/companySettings";
import {
  buildCompanyStatements,
  buildLeaderStatements,
  detectSpecialLeaderIds,
  PERIOD_LABEL,
  setSpecialOneTimeItems,
  type PeriodKey,
  type StmtCompany,
  type StmtDelivery,
  type StmtLeader,
  type StmtCommonDeduction,
  type StmtCommonOverride,
  type StmtPeriodDeduction,
  type DeductionContext,
} from "@/lib/statementData";
import {
  validateCompanyStatement,
  validateLeaderStatement,
  validateOeunkyuTransferCoverage,
  mergeResults,
  type CheckResult,
} from "@/lib/statementValidation";
import { validateSettlementInvariants } from "@/lib/settlementInvariants";
import { toast } from "@/hooks/use-toast";
import { exportSingle, exportZip, printTargets, type ExportTarget } from "@/lib/statementExport";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Cloud, CloudOff, FolderOpen, FolderCheck, Printer } from "lucide-react";
import { getCurrentHalf, useAutoPeriodSync } from "@/lib/autoPeriod";
import {
  pickSaveDirectory,
  getSavedDirectoryHandle,
  clearSavedDirectoryHandle,
  isFsAccessSupported,
  ensureWritePermission,
} from "@/lib/saveDirectory";

function getCurrentSavingPeriod() {
  const { month, half } = getCurrentHalf();
  return { month, period: half as PeriodKey };
}

export default function Saves() {
  const { user } = useAuth();
  const uid = user?.id;
  const settings = useMemo(() => (uid ? loadCompanySettings(uid) : null), [uid]);

  // 날짜에 맞춰 자동으로 월/기간 초기화
  const initial = useMemo(() => getCurrentSavingPeriod(), []);
  const autoPeriodInitial = (() => {
    try { return localStorage.getItem("saves.autoPeriod") !== "0"; } catch { return true; }
  })();
  const [month, setMonth] = useState<string>(() =>
    autoPeriodInitial ? initial.month : (settings?.defaultMonth || initial.month)
  );
  const [period, setPeriod] = useState<PeriodKey>(() =>
    autoPeriodInitial ? initial.period : initial.period
  );
  const [autoPeriod, setAutoPeriod] = useState<boolean>(autoPeriodInitial);
  const toggleAutoPeriod = (v: boolean) => {
    setAutoPeriod(v);
    try { localStorage.setItem("saves.autoPeriod", v ? "1" : "0"); } catch { /* noop */ }
    if (v) {
      const cur = getCurrentSavingPeriod();
      setMonth(cur.month);
      setPeriod(cur.period);
    }
  };

  // 자동 모드: 자정 경계/포커스/가시성/bfcache/온라인 복귀 시 정확히 재동기화
  useAutoPeriodSync(autoPeriod, () => {
    const cur = getCurrentSavingPeriod();
    setMonth((prev) => (prev === cur.month ? prev : cur.month));
    setPeriod((prev) => (prev === cur.period ? prev : cur.period));
  });

  const [companies, setCompanies] = useState<StmtCompany[]>([]);
  const [leaders, setLeaders] = useState<StmtLeader[]>([]);
  const [deliveries, setDeliveries] = useState<StmtDelivery[]>([]);
  const [hqHolidays, setHqHolidays] = useState<Set<string>>(new Set());
  const [commonDeductions, setCommonDeductions] = useState<StmtCommonDeduction[]>([]);
  const [commonOverrides, setCommonOverrides] = useState<StmtCommonOverride[]>([]);
  const [periodDeductions, setPeriodDeductions] = useState<StmtPeriodDeduction[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedLeaderId, setSelectedLeaderId] = useState<string | null>(null);
  const [companyQuery, setCompanyQuery] = useState<string>("");
  const [leaderQuery, setLeaderQuery] = useState<string>("");
  const normSearch = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");

  async function reload() {
    if (!uid) return;
    setLoading(true);
    try {
      const [y, m] = month.split("-").map(Number);
      const from = `${month}-01`;
      const last = new Date(y, m, 0).getDate();
      const to = `${month}-${String(last).padStart(2, "0")}`;
      const periodKey = period === "all" ? "all" : `${month}-${period === "h1" ? "first" : "second"}`;
      const commonKeys = period === "all"
        ? [`${month}-first`, `${month}-second`]
        : [`${month}-${period === "h1" ? "first" : "second"}`];
      const [{ data: cs }, { data: ls }, { data: ds }, { data: hs }, { data: cds }, { data: ovs }, { data: pds }] = await Promise.all([
        supabase.from("companies").select("*").eq("user_id", uid).order("name"),
        supabase.from("team_leaders").select("*").eq("user_id", uid).order("name"),
        supabase.from("deliveries").select("*").eq("user_id", uid).gte("date", from).lte("date", to),
        supabase.from("holidays").select("date,scope").eq("user_id", uid).eq("scope", "hq"),
        supabase.from("common_deductions").select("id,label,amount,active").eq("user_id", uid).order("sort_order"),
        supabase.from("leader_common_overrides").select("leader_id,common_deduction_id,period_key,amount").eq("user_id", uid).in("period_key", commonKeys),
        supabase.from("leader_period_deductions").select("leader_id,period_key,label,amount").eq("user_id", uid).eq("period_key", periodKey),
      ]);
      setCompanies((cs ?? []) as unknown as StmtCompany[]);
      setLeaders((ls ?? []) as unknown as StmtLeader[]);
      setDeliveries((ds ?? []) as unknown as StmtDelivery[]);
      setHqHolidays(new Set(((hs ?? []) as Array<{ date: string }>).map((h) => h.date)));
      setCommonDeductions((cds ?? []) as unknown as StmtCommonDeduction[]);
      setCommonOverrides((ovs ?? []) as unknown as StmtCommonOverride[]);
      setPeriodDeductions((pds ?? []) as unknown as StmtPeriodDeduction[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [uid, month, period]);

  // 특수일 품목 (행사철수 등) 로드 → statementData 모듈에 주입
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const { data } = await supabase
        .from("special_items" as any)
        .select("label,active")
        .eq("user_id", uid);
      const labels = ((data as any[]) || [])
        .filter((r) => r.active)
        .map((r) => String(r.label || "").trim())
        .filter((l) => l.length > 0);
      // 비어있으면 기본값(행사철수) 유지
      if (labels.length > 0) setSpecialOneTimeItems(labels);
    })();
  }, [uid]);

  const special = useMemo(() => detectSpecialLeaderIds(leaders), [leaders]);
  const oeunkyuSpecial = settings?.oeunkyuSpecial ?? true;

  const deductionCtx: DeductionContext = useMemo(() => {
    const periodKey = period === "all" ? "all" : `${month}-${period === "h1" ? "first" : "second"}`;
    const commonPeriodKeys = period === "all"
      ? [`${month}-first`, `${month}-second`]
      : [`${month}-${period === "h1" ? "first" : "second"}`];
    return { commonDeductions, commonOverrides, periodDeductions, periodKey, commonPeriodKeys };
  }, [commonDeductions, commonOverrides, periodDeductions, period, month]);

  const companyStmts = useMemo(
    () => buildCompanyStatements(deliveries, companies, leaders, period),
    [deliveries, companies, leaders, period],
  );
  const leaderStmts = useMemo(
    () => buildLeaderStatements(deliveries, leaders, period, { ...special, oeunkyuSpecial }, deductionCtx),
    [deliveries, leaders, period, special, oeunkyuSpecial, deductionCtx],
  );

  // 기본 선택 자동 동기화
  useEffect(() => {
    if (!selectedCompanyId && companyStmts[0]) setSelectedCompanyId(companyStmts[0].company.id);
    if (selectedCompanyId && !companyStmts.find((s) => s.company.id === selectedCompanyId))
      setSelectedCompanyId(companyStmts[0]?.company.id ?? null);
  }, [companyStmts, selectedCompanyId]);
  useEffect(() => {
    if (!selectedLeaderId && leaderStmts[0]) setSelectedLeaderId(leaderStmts[0].leader.id);
    if (selectedLeaderId && !leaderStmts.find((s) => s.leader.id === selectedLeaderId))
      setSelectedLeaderId(leaderStmts[0]?.leader.id ?? null);
  }, [leaderStmts, selectedLeaderId]);

  const selectedCompany = companyStmts.find((s) => s.company.id === selectedCompanyId);
  const selectedLeader = leaderStmts.find((s) => s.leader.id === selectedLeaderId);

  const filteredCompanyStmts = useMemo(() => {
    const q = normSearch(companyQuery);
    if (!q) return companyStmts;
    return companyStmts.filter((s) => normSearch(s.company.name).includes(q));
  }, [companyStmts, companyQuery]);
  const filteredLeaderStmts = useMemo(() => {
    const q = normSearch(leaderQuery);
    if (!q) return leaderStmts;
    return leaderStmts.filter((s) => {
      if (normSearch(s.leader.name).includes(q)) return true;
      const aliases = (s.leader as { aliases?: string[] | null }).aliases ?? [];
      return aliases.some((a) => normSearch(a).includes(q));
    });
  }, [leaderStmts, leaderQuery]);

  // ─── PNG 렌더 대상 노드 보관 (숨겨진 영역) ─────────────
  const exportRoot = useRef<HTMLDivElement>(null);
  const [exportingMsg, setExportingMsg] = useState<string>("");

  // ─── 중복 실행 잠금 (기간·탭 단위) ───────────────────────
  // 키 형태: "company:<month>:<period>" / "leader:<month>:<period>"
  // 재생성/전체 저장은 해당 탭의 키를 잠그며, both-all 은 두 탭을 동시에 잠근다.
  // ref + state 동시 관리: ref 는 즉시 반영되어 동일 tick 내 중복 클릭/타이머 경쟁을 차단,
  // state 는 disabled UI 갱신용으로 사용한다.
  const locksRef = useRef<Set<string>>(new Set());
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const lockKey = (kind: "company" | "leader") => `${kind}:${month}:${period}`;
  const isLocked = (kind: "company" | "leader") => locks.has(lockKey(kind));
  const acquireLocks = (keys: string[]): boolean => {
    // ref 기준으로 즉시 검사 — 동일 tick 내 중복 진입 차단
    for (const k of keys) if (locksRef.current.has(k)) return false;
    keys.forEach((k) => locksRef.current.add(k));
    setLocks(new Set(locksRef.current));
    return true;
  };
  const releaseLocks = (keys: string[]) => {
    keys.forEach((k) => locksRef.current.delete(k));
    setLocks(new Set(locksRef.current));
  };

  function collectNodes(kind: "company" | "leader"): ExportTarget[] {
    if (!exportRoot.current) return [];
    const out: ExportTarget[] = [];
    const items = kind === "company"
      ? companyStmts.map((s) => ({ id: s.company.id, name: s.company.name }))
      : leaderStmts.map((s) => ({ id: s.leader.id, name: s.leader.name }));
    for (const it of items) {
      const pages = Array.from(
        exportRoot.current.querySelectorAll<HTMLElement>(
          `[data-stmt-id="${kind}:${it.id}"]`,
        ),
      ).sort((a, b) =>
        Number(a.dataset.stmtPage ?? "0") - Number(b.dataset.stmtPage ?? "0"),
      );
      if (pages.length > 0) out.push({ kind, id: it.id, name: it.name, pages });
    }
    return out;
  }

  async function doExportSingle(kind: "company" | "leader", id: string, name: string, regenerate: boolean) {
    const keys = [lockKey(kind)];
    if (!acquireLocks(keys)) {
      toast({ title: "이미 저장 중", description: `${kind === "company" ? "업체" : "팀장"} ${month} ${period} 작업이 진행 중입니다.`, variant: "destructive" });
      return;
    }
    const nodes = collectNodes(kind);
    const target = nodes.find((n) => n.id === id);
    if (!target) {
      toast({ title: "저장 실패", description: "렌더 대상 없음", variant: "destructive" });
      releaseLocks(keys);
      return;
    }
    setExportingMsg(`${name} 저장 중…`);
    try {
      const dir = await getReadyDir();
      const { filename } = await exportSingle(target, month, period, regenerate, { uploadOneDrive: uploadOD, saveDirectory: dir });
      toast({ title: "저장 완료", description: filename });
    } catch (e) {
      toast({ title: "저장 실패", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setExportingMsg("");
      releaseLocks(keys);
    }
  }

  async function doExportAll(kind: "company" | "leader" | "both", regenerate: boolean) {
    const keys = kind === "both" ? [lockKey("company"), lockKey("leader")] : [lockKey(kind)];
    if (!acquireLocks(keys)) {
      toast({ title: "이미 저장 중", description: `${month} ${period} 작업이 진행 중입니다.`, variant: "destructive" });
      return;
    }
    // 청구금액 0 업체 / 정산내역 없는 팀장 자동 제외
    const skipCompany = new Set(
      companyStmts.filter((s) => s.finalClaim <= 0).map((s) => s.company.id),
    );
    const skipLeader = new Set(
      leaderStmts.filter((s) => s.deliveryCount === 0).map((s) => s.leader.id),
    );
    const allNodes =
      kind === "company" ? collectNodes("company")
      : kind === "leader" ? collectNodes("leader")
      : [...collectNodes("company"), ...collectNodes("leader")];
    const targets = allNodes.filter((t) =>
      t.kind === "company" ? !skipCompany.has(t.id) : !skipLeader.has(t.id),
    );
    const skippedCompanies = (kind === "company" || kind === "both")
      ? companyStmts.filter((s) => skipCompany.has(s.company.id))
      : [];
    const skippedLeaders = (kind === "leader" || kind === "both")
      ? leaderStmts.filter((s) => skipLeader.has(s.leader.id))
      : [];
    if (targets.length === 0) {
      toast({ title: "저장 대상 없음", variant: "destructive" });
      releaseLocks(keys);
      return;
    }
    try {
      const { filename, count } = await exportZip(
        targets, month, period, regenerate,
        (done, total, name) => setExportingMsg(`${done}/${total} ${name}`),
        { uploadOneDrive: uploadOD, saveDirectory: await getReadyDir() },
      );
      const skipCount = skippedCompanies.length + skippedLeaders.length;
      setBulkResult({
        kind, filename, savedCount: count,
        skippedCompanies: skippedCompanies.map((s) => ({ name: s.company.name, reason: "청구금액 없음" })),
        skippedLeaders: skippedLeaders.map((s) => ({ name: s.leader.name, reason: "정산내역 없음" })),
      });
      toast({ title: "저장 완료", description: `${filename} (${count}건 저장, ${skipCount}건 제외)` });
    } catch (e) {
      toast({ title: "저장 실패", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setExportingMsg("");
      releaseLocks(keys);
    }
  }

  // 전체저장 결과 패널
  const [bulkResult, setBulkResult] = useState<null | {
    kind: "company" | "leader" | "both";
    filename: string;
    savedCount: number;
    skippedCompanies: { name: string; reason: string }[];
    skippedLeaders: { name: string; reason: string }[];
  }>(null);

  // ─── OneDrive 업로드 옵션 ────────────────────────────────
  const [uploadOD, setUploadOD] = useState<boolean>(() => {
    try { return localStorage.getItem("saves.uploadOD") === "1"; } catch { return false; }
  });
  const toggleUploadOD = (v: boolean) => {
    setUploadOD(v);
    try { localStorage.setItem("saves.uploadOD", v ? "1" : "0"); } catch { /* noop */ }
  };

  // ─── 저장 폴더 (바탕화면/삼호정산서) ─────────────────────
  const [saveDir, setSaveDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [saveDirName, setSaveDirName] = useState<string>("");
  useEffect(() => {
    (async () => {
      const h = await getSavedDirectoryHandle();
      if (h) { setSaveDir(h); setSaveDirName(h.name); }
    })();
  }, []);
  async function onPickSaveDir() {
    try {
      const h = await pickSaveDirectory();
      setSaveDir(h);
      setSaveDirName(h.name);
      toast({ title: "저장 폴더 지정 완료", description: `${h.name} (이 폴더 안에 오늘날짜_정산서/업체|팀장 자동 생성)` });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/abort/i.test(msg)) {
        toast({ title: "폴더 지정 실패", description: msg, variant: "destructive" });
      }
    }
  }
  async function onClearSaveDir() {
    await clearSavedDirectoryHandle();
    setSaveDir(null);
    setSaveDirName("");
    toast({ title: "저장 폴더 해제", description: "이후 저장은 브라우저 기본 다운로드 폴더로 진행됩니다." });
  }
  // 저장 직전 권한 확인 (사용자 제스처 컨텍스트에서 호출)
  async function getReadyDir(): Promise<FileSystemDirectoryHandle | null> {
    if (!saveDir) return null;
    const ok = await ensureWritePermission(saveDir);
    if (!ok) {
      toast({ title: "폴더 권한 거부", description: "저장 폴더를 다시 지정해 주세요.", variant: "destructive" });
      return null;
    }
    return saveDir;
  }

  // ─── 기간 변경 자동저장 옵션 ────────────────────────────
  const [autoSaveOnChange, setAutoSaveOnChange] = useState<boolean>(() => {
    try { return localStorage.getItem("saves.autoSaveOnChange") === "1"; } catch { return false; }
  });
  const toggleAutoSaveOnChange = (v: boolean) => {
    setAutoSaveOnChange(v);
    try { localStorage.setItem("saves.autoSaveOnChange", v ? "1" : "0"); } catch { /* noop */ }
  };
  const autoSavedKey = (m: string, p: PeriodKey) =>
    `saves.autoSaved.${uid ?? "anon"}.${m}.${p}`;
  const isAutoSavedFor = (m: string, p: PeriodKey) => {
    try { return localStorage.getItem(autoSavedKey(m, p)) === "1"; } catch { return false; }
  };
  const markAutoSavedFor = (m: string, p: PeriodKey) => {
    try { localStorage.setItem(autoSavedKey(m, p), "1"); } catch { /* noop */ }
  };
  const autoSavingRef = useRef<string | null>(null);
  // 최초 마운트 시점의 (month, period) 를 기록 → 이후 "변경"된 경우에만 자동저장
  const lastPeriodRef = useRef<string>(`${month}:${period}`);
  const mountedRef = useRef(false);
  const [verifyingOD, setVerifyingOD] = useState(false);
  async function verifyOneDrive() {
    setVerifyingOD(true);
    try {
      const { data, error } = await supabase.functions.invoke("onedrive-upload", { body: { action: "verify" } });
      if (error) throw new Error(error.message);
      if (data?.ok) {
        toast({ title: "OneDrive 연결 확인", description: `드라이브: ${data.drive?.name ?? "OK"}${data.drive?.owner ? ` (${data.drive.owner})` : ""}` });
      } else {
        toast({ title: "OneDrive 연결 실패", description: data?.error ?? "응답 없음", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "OneDrive 연결 실패", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setVerifyingOD(false);
    }
  }

  // ─── 저장 전 오류 검사 + 후속 저장 액션 ────────────────────
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [pendingSave, setPendingSave] = useState<null | (() => void)>(null);
  const [pendingPartial, setPendingPartial] = useState<null | { fn: () => void; count: number; label: string }>(null);
  const [checkTitle, setCheckTitle] = useState<string>("");

  /**
   * scope:
   *  - "company-one" / "company-all"
   *  - "leader-one"  / "leader-all"
   *  - "both-all"  (재생성 / 저장 전 오류 검사)
   */
  type Scope = "company-one" | "company-all" | "leader-one" | "leader-all" | "both-all";

  function runChecksFor(scope: Scope): CheckResult {
    const results: CheckResult[] = [];
    const targetsC: typeof companyStmts =
      scope === "company-one" && selectedCompany ? [selectedCompany]
      : scope === "company-all" || scope === "both-all" ? companyStmts
      : [];
    const targetsL: typeof leaderStmts =
      scope === "leader-one" && selectedLeader ? [selectedLeader]
      : scope === "leader-all" || scope === "both-all" ? leaderStmts
      : [];

    for (const data of targetsC) results.push(validateCompanyStatement(data));
    for (const data of targetsL) {
      results.push(
        validateLeaderStatement(data, { leaders, ...special, oeunkyuSpecial }),
      );
    }
    // 오은규→오동선 누락 (팀장 검사가 포함된 경우만 1회)
    if (targetsL.length > 0 && special.oeunkyuId && special.odongseonId) {
      const odongseonStmt = leaderStmts.find((s) => s.leader.id === special.odongseonId);
      results.push(
        validateOeunkyuTransferCoverage(
          deliveries,
          odongseonStmt,
          special.oeunkyuId,
          special.odongseonId,
          oeunkyuSpecial,
        ),
      );
    }
    // 전 데이터셋 불변식 검사 — 5대 영역 (분류/착불/분배/합계/공제) 100% 점검
    // scope 와 무관하게 항상 실행하여 어떤 저장 흐름에서도 빠짐없이 차단한다.
    results.push(
      validateSettlementInvariants(deliveries, companyStmts, leaderStmts, {
        shindongseokId: special.shindongseokId,
        ganghyungjuId: special.ganghyungjuId,
        virtualIds: new Set(leaders.filter((l) => l.is_virtual).map((l) => l.id)),
        deductionCtx,
      }),
    );
    return mergeResults(...results);
  }

  /** scope 내에서 개별 대상별로 오류가 있는 id 집합을 구한다. */
  function findErroredIds(scope: Scope): { companyIds: Set<string>; leaderIds: Set<string> } {
    const companyIds = new Set<string>();
    const leaderIds = new Set<string>();
    if (scope === "company-all" || scope === "both-all") {
      for (const data of companyStmts) {
        if (!validateCompanyStatement(data).ok) companyIds.add(data.company.id);
      }
    }
    if (scope === "leader-all" || scope === "both-all") {
      for (const data of leaderStmts) {
        if (!validateLeaderStatement(data, { leaders, ...special, oeunkyuSpecial }).ok)
          leaderIds.add(data.leader.id);
      }
    }
    return { companyIds, leaderIds };
  }

  function withValidation(title: string, scope: Scope, save: () => void) {
    const result = runChecksFor(scope);
    setCheckTitle(title);
    setCheckResult(result);
    if (result.ok && result.warnings.length === 0) {
      // 완전 통과 → 즉시 다이얼로그 닫고 실행
      setCheckResult(null);
      save();
      return;
    }
    // 오류 or 경고 → 다이얼로그 표시. setState(fn) 은 updater 로 해석되므로 한 번 더 감싼다.
    setPendingSave(() => (result.ok ? save : null));
    // 전체 저장에서 오류가 있으면 "오류 없는 항목만 저장" 옵션 제공
    if (!result.ok && (scope === "company-all" || scope === "leader-all" || scope === "both-all")) {
      const { companyIds, leaderIds } = findErroredIds(scope);
      const okCompanies = scope !== "leader-all" ? companyStmts.filter((s) => !companyIds.has(s.company.id)).length : 0;
      const okLeaders = scope !== "company-all" ? leaderStmts.filter((s) => !leaderIds.has(s.leader.id)).length : 0;
      const total = okCompanies + okLeaders;
      if (total > 0) {
        const kind = scope === "company-all" ? "company" : scope === "leader-all" ? "leader" : "both";
        setPendingPartial({
          fn: () => doExportAllFiltered(kind, false, companyIds, leaderIds),
          count: total,
          label: `오류 없는 ${scope === "leader-all" ? "팀장" : scope === "company-all" ? "업체" : "항목"}만 저장 (${total}건)`,
        });
      } else {
        setPendingPartial(null);
      }
    } else {
      setPendingPartial(null);
    }
  }

  async function doExportAllFiltered(
    kind: "company" | "leader" | "both",
    regenerate: boolean,
    skipCompanyIds: Set<string>,
    skipLeaderIds: Set<string>,
  ) {
    const keys = kind === "both" ? [lockKey("company"), lockKey("leader")] : [lockKey(kind)];
    if (!acquireLocks(keys)) {
      toast({ title: "이미 저장 중", variant: "destructive" });
      return;
    }
    const all =
      kind === "company" ? collectNodes("company")
      : kind === "leader" ? collectNodes("leader")
      : [...collectNodes("company"), ...collectNodes("leader")];
    const targets = all.filter((t) =>
      t.kind === "company" ? !skipCompanyIds.has(t.id) : !skipLeaderIds.has(t.id),
    );
    if (targets.length === 0) {
      toast({ title: "저장 대상 없음", variant: "destructive" });
      releaseLocks(keys);
      return;
    }
    try {
      const { filename, count } = await exportZip(
        targets, month, period, regenerate,
        (done, total, name) => setExportingMsg(`${done}/${total} ${name}`),
        { uploadOneDrive: uploadOD, saveDirectory: await getReadyDir() },
      );
      toast({ title: "저장 완료", description: `${filename} (${count}건, 오류 ${all.length - count}건 제외)` });
    } catch (e) {
      toast({ title: "저장 실패", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setExportingMsg("");
      releaseLocks(keys);
    }
  }

  const onSaveCompanyOne = () => selectedCompany && withValidation(
    `${selectedCompany.company.name} 정산서 저장`,
    "company-one",
    () => {
      if (selectedCompany.finalClaim <= 0) {
        if (!window.confirm("해당 업체는 선택 기간 청구금액이 없습니다. 그래도 정산서를 저장하시겠습니까?")) return;
      }
      doExportSingle("company", selectedCompany.company.id, selectedCompany.company.name, false);
    },
  );
  const onSaveCompanyAll = () => withValidation(
    "업체 전체 정산서 저장", "company-all",
    () => doExportAll("company", false),
  );
  const onSaveLeaderOne = () => selectedLeader && withValidation(
    `${selectedLeader.leader.name} 정산서 저장`,
    "leader-one",
    () => doExportSingle("leader", selectedLeader.leader.id, selectedLeader.leader.name, false),
  );
  const onSaveLeaderAll = () => withValidation(
    "팀장 전체 정산서 저장", "leader-all",
    () => doExportAll("leader", false),
  );
  const onRegenerate = () => withValidation(
    "정산서 재생성", "both-all",
    () => doExportAll("both", true),
  );

  // ─── 인쇄 (저장되는 사진과 동일 이미지) ───────────────────
  async function doPrint(kind: "company" | "leader", ids?: string[]) {
    const all = collectNodes(kind);
    const targets = ids ? all.filter((t) => ids.includes(t.id)) : all;
    if (targets.length === 0) {
      toast({ title: "인쇄 대상 없음", variant: "destructive" });
      return;
    }
    setExportingMsg(`${kind === "company" ? "업체" : "팀장"} 인쇄 준비 중…`);
    try {
      const { count, pages } = await printTargets(
        targets,
        (done, total, name) => setExportingMsg(`${done}/${total} ${name}`),
      );
      toast({ title: "인쇄 다이얼로그 열림", description: `${count}건 · ${pages}장` });
    } catch (e) {
      toast({ title: "인쇄 실패", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setExportingMsg("");
    }
  }
  const onPrintCompanyOne = () => selectedCompany && doPrint("company", [selectedCompany.company.id]);
  const onPrintCompanyAll = () => {
    const ids = companyStmts.filter((s) => s.finalClaim > 0).map((s) => s.company.id);
    doPrint("company", ids);
  };
  const onPrintLeaderOne = () => selectedLeader && doPrint("leader", [selectedLeader.leader.id]);
  const onPrintLeaderAll = () => {
    const ids = leaderStmts.filter((s) => s.deliveryCount > 0).map((s) => s.leader.id);
    doPrint("leader", ids);
  };

  const onCheckOnly = () => {
    const result = runChecksFor("both-all");
    setCheckTitle("저장 전 오류 검사 결과 (업체 + 팀장)");
    setCheckResult(result);
    setPendingSave(null);
  };

  // 정산마감 게이트 제거 — 언제든지 저장 가능
  const blockedReason: string | undefined = undefined;
  const saveBlocked = false;

  // ─── 기간 변경 시 자동저장 (업체+팀장 전체, 1회) ──────────
  useEffect(() => {
    const key = `${month}:${period}`;
    // 첫 마운트는 스킵 (페이지 진입만으로 자동저장하지 않음 → 저장 버튼 잠금 방지)
    if (!mountedRef.current) {
      mountedRef.current = true;
      lastPeriodRef.current = key;
      return;
    }
    // (month, period) 가 실제로 바뀐 경우에만 동작 (loading 완료까지 ref 갱신은 보류)
    if (lastPeriodRef.current === key) return;

    if (!autoSaveOnChange) return;
    if (!uid) return;
    if (loading) return;
    if (autoSavingRef.current === key) return;
    if (isAutoSavedFor(month, period)) { lastPeriodRef.current = key; return; }
    if (locks.has(lockKey("company")) || locks.has(lockKey("leader"))) return;
    // 저장 대상이 하나도 없으면 스킵 (플래그도 세우지 않음 → 데이터 들어오면 재시도)
    const hasCompany = companyStmts.some((s) => s.finalClaim > 0);
    const hasLeader = leaderStmts.some((s) => s.deliveryCount > 0);
    if (!hasCompany && !hasLeader) return;
    autoSavingRef.current = key;
    lastPeriodRef.current = key;
    // DOM(숨겨진 export 노드)이 그려질 시간을 확보
    const t = setTimeout(async () => {
      try {
        await doExportAll("both", false);
        markAutoSavedFor(month, period);
      } finally {
        autoSavingRef.current = null;
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, month, period, loading, companyStmts, leaderStmts, autoSaveOnChange]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">정산서저장</h1>
          <p className="text-sm text-muted-foreground">
            업체·팀장 정산서를 기간별로 JPG 이미지로 저장합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">정산월</Label>
            <Input
              type="month"
              value={month}
              onChange={(e) => { setMonth(e.target.value); }}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">기간</Label>
            <Select value={period} onValueChange={(v) => { setPeriod(v as PeriodKey); }}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="h1">1~15일</SelectItem>
                <SelectItem value="h2">16~말일</SelectItem>
                <SelectItem value="all">월전체</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">날짜 자동</Label>
            <div className="flex h-10 items-center gap-2 rounded-md border px-3">
              <Switch checked={autoPeriod} onCheckedChange={toggleAutoPeriod} />
              <span className="text-xs text-muted-foreground">
                {autoPeriod ? "자동" : "수동"}
              </span>
            </div>
          </div>
          <Button variant="outline" onClick={reload} disabled={loading}>
            새로고침
          </Button>
        </div>
      </div>

      {/* 기본 액션 버튼 */}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <GateButton reason={blockedReason} onClick={onSaveCompanyOne} disabled={!selectedCompany || isLocked("company") || saveBlocked}>업체 사진 저장</GateButton>
          <GateButton reason={blockedReason} onClick={onSaveCompanyAll} disabled={companyStmts.length === 0 || isLocked("company") || saveBlocked}>업체 전체 사진 저장</GateButton>
          <GateButton reason={blockedReason} onClick={onSaveLeaderOne} disabled={!selectedLeader || isLocked("leader") || saveBlocked}>팀장 사진 저장</GateButton>
          <GateButton reason={blockedReason} onClick={onSaveLeaderAll} disabled={leaderStmts.length === 0 || isLocked("leader") || saveBlocked}>팀장 전체 사진 저장</GateButton>
          <GateButton reason={blockedReason} variant="secondary" onClick={onRegenerate} disabled={isLocked("company") || isLocked("leader") || saveBlocked}>정산서 재생성</GateButton>
          <Button size="lg" variant="outline" className="h-14" onClick={onCheckOnly}>저장 전 오류 검사</Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 border-t pt-3">
          <Button size="lg" variant="outline" className="h-14" onClick={onPrintCompanyOne} disabled={!selectedCompany}>
            <Printer className="mr-2 h-4 w-4" /> 업체 인쇄
          </Button>
          <Button size="lg" variant="outline" className="h-14" onClick={onPrintCompanyAll} disabled={companyStmts.length === 0}>
            <Printer className="mr-2 h-4 w-4" /> 업체 전체 인쇄
          </Button>
          <Button size="lg" variant="outline" className="h-14" onClick={onPrintLeaderOne} disabled={!selectedLeader}>
            <Printer className="mr-2 h-4 w-4" /> 팀장 인쇄
          </Button>
          <Button size="lg" variant="outline" className="h-14" onClick={onPrintLeaderAll} disabled={leaderStmts.length === 0}>
            <Printer className="mr-2 h-4 w-4" /> 팀장 전체 인쇄
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
          <div className="flex items-center gap-2">
            {uploadOD ? <Cloud className="h-4 w-4 text-primary" /> : <CloudOff className="h-4 w-4 text-muted-foreground" />}
            <Label htmlFor="save-od" className="cursor-pointer">OneDrive에도 업로드</Label>
            <Switch id="save-od" checked={uploadOD} onCheckedChange={toggleUploadOD} />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="save-auto" className="cursor-pointer">기간 변경 시 자동저장</Label>
            <Switch id="save-auto" checked={autoSaveOnChange} onCheckedChange={toggleAutoSaveOnChange} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                try { localStorage.removeItem(autoSavedKey(month, period)); } catch { /* noop */ }
                toast({ title: "자동저장 플래그 해제", description: `${month} ${PERIOD_LABEL[period]} — 다음 동기화에서 다시 저장됩니다.` });
              }}
            >
              이 기간 다시 저장
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={verifyOneDrive} disabled={verifyingOD}>
            {verifyingOD ? "확인 중…" : "OneDrive 연결 확인"}
          </Button>
          <span className="text-xs text-muted-foreground">
            업로드 폴더: <span className="font-mono">정산서_저장/{month}_{period === "h1" ? "1-15일" : period === "h2" ? "16-말일" : "월전체"}/업체|팀장/</span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
          {saveDir ? (
            <>
              <FolderCheck className="h-4 w-4 text-primary" />
              <span className="text-xs">
                저장 폴더: <span className="font-mono font-semibold">{saveDirName}</span>
                <span className="ml-1 text-muted-foreground">/ {new Date().toISOString().slice(0,10)}_정산서 / 업체|팀장 / *.jpg</span>
              </span>
              <Button variant="outline" size="sm" onClick={onPickSaveDir}>
                <FolderOpen className="mr-1 h-3.5 w-3.5" /> 폴더 변경
              </Button>
              <Button variant="ghost" size="sm" onClick={onClearSaveDir}>해제</Button>
            </>
          ) : (
            <>
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                저장 폴더 미지정 — 브라우저 기본 다운로드 폴더로 저장됩니다.
              </span>
              <Button variant="default" size="sm" onClick={onPickSaveDir} disabled={!isFsAccessSupported()}>
                <FolderOpen className="mr-1 h-3.5 w-3.5" /> 저장 폴더 지정 (바탕화면/삼호정산서)
              </Button>
              {!isFsAccessSupported() && (
                <span className="text-[11px] text-destructive">※ 이 브라우저는 폴더 직접 저장을 지원하지 않습니다(Chrome/Edge 권장).</span>
              )}
            </>
          )}
        </div>
      </Card>

      <Tabs defaultValue="company" className="space-y-3">
        <TabsList>
          <TabsTrigger value="company">업체 정산서 ({companyStmts.length})</TabsTrigger>
          <TabsTrigger value="leader">팀장 정산서 ({leaderStmts.length})</TabsTrigger>
        </TabsList>

        {/* 업체 탭 */}
        <TabsContent value="company">
          <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
            <Card className="p-3">
              <div className="mb-2 text-sm font-semibold">업체 목록</div>
              <Input
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                placeholder="업체명 검색"
                className="mb-2 h-8 text-sm"
              />
              <ScrollArea className="h-[520px]">
                <div className="space-y-1 pr-2">
                  {filteredCompanyStmts.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {companyStmts.length === 0
                        ? "해당 기간 정산 대상 업체가 없습니다."
                        : "검색 결과가 없습니다."}
                    </p>
                  )}
                  {filteredCompanyStmts.map((s) => {
                    const active = s.company.id === selectedCompanyId;
                    const noClaim = s.finalClaim <= 0;
                    return (
                      <button
                        key={s.company.id}
                        type="button"
                        onClick={() => setSelectedCompanyId(s.company.id)}
                        className={
                          "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition " +
                          (active
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-muted")
                        }
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{s.company.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            청구 {fmt(s.finalClaim)}원
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {noClaim
                            ? <Badge variant="outline" className="text-[10px] border-yellow-400 text-yellow-700 dark:text-yellow-300">청구금액 없음</Badge>
                            : <Badge className="text-[10px]">저장가능</Badge>}
                          <Badge variant="outline" className="text-[10px]">{s.rows.length}건</Badge>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>

            <Card className="p-4">
              {selectedCompany ? (
                <CompanyPreview data={selectedCompany} />
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  업체를 선택하세요.
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* 팀장 탭 */}
        <TabsContent value="leader">
          <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
            <Card className="p-3">
              <div className="mb-2 text-sm font-semibold">팀장 목록</div>
              <Input
                value={leaderQuery}
                onChange={(e) => setLeaderQuery(e.target.value)}
                placeholder="팀장명/별칭 검색"
                className="mb-2 h-8 text-sm"
              />
              <ScrollArea className="h-[520px]">
                <div className="space-y-1 pr-2">
                  {filteredLeaderStmts.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {leaderStmts.length === 0
                        ? "해당 기간 정산 대상 팀장이 없습니다."
                        : "검색 결과가 없습니다."}
                    </p>
                  )}
                  {filteredLeaderStmts.map((s) => {
                    const active = s.leader.id === selectedLeaderId;
                    const empty = s.deliveryCount === 0;
                    return (
                      <button
                        key={s.leader.id}
                        type="button"
                        onClick={() => setSelectedLeaderId(s.leader.id)}
                        className={
                          "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition " +
                          (active
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-muted")
                        }
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{s.leader.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            총합 {fmt(s.metroSum + s.noteSum + s.regionalSum)}원
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {empty
                            ? <Badge variant="outline" className="text-[10px] border-yellow-400 text-yellow-700 dark:text-yellow-300">정산내역 없음</Badge>
                            : <Badge className="text-[10px]">저장가능</Badge>}
                          <Badge variant="outline" className="text-[10px]">{s.deliveryCount}건</Badge>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>

            <Card className="p-4">
              {selectedLeader ? (
                <LeaderPreview data={selectedLeader} />
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  팀장을 선택하세요.
                </div>
              )}
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        ※ 미리보기는 화면용입니다. 저장 시 동일 데이터로 카톡 공유용 PNG가 생성됩니다.
        파일명: 업체_업체명_기간_v1.jpg · 팀장_팀장명_기간_v1.jpg (재생성 시 v2, v3로 자동 증가).
      </p>

      {exportingMsg && (
        <div className="fixed bottom-4 right-4 z-50 rounded-md border bg-background px-4 py-2 text-sm shadow">
          {exportingMsg}
        </div>
      )}

      {/* 숨겨진 PNG 렌더 영역: 화면에는 안 보이지만 DOM에는 존재해야 html-to-image가 캡처 가능 */}
      <div
        ref={exportRoot}
        aria-hidden
        style={{
          position: "fixed",
          left: -10000,
          top: 0,
          width: 1400,
          background: "#ffffff",
          color: "#000000",
          pointerEvents: "none",
        }}
      >
        {companyStmts.flatMap((s) => {
          const pages = paginate(s.rows.length, 25);
          return pages.map((slice, idx) => (
            <div
              key={`c-${s.company.id}-${idx}`}
              data-stmt-id={`company:${s.company.id}`}
              data-stmt-page={idx + 1}
              className="p-6 bg-white text-black"
            >
              <CompanyPreview
                data={s}
                rowsSlice={slice}
                pageIndex={idx + 1}
                totalPages={pages.length}
              />
            </div>
          ));
        })}
        {leaderStmts.flatMap((s) => {
          const pages = paginate(s.rows.length, 25);
          return pages.map((slice, idx) => (
            <div
              key={`l-${s.leader.id}-${idx}`}
              data-stmt-id={`leader:${s.leader.id}`}
              data-stmt-page={idx + 1}
              className="p-6 bg-white text-black"
            >
              <LeaderPreview
                data={s}
                rowsSlice={slice}
                pageIndex={idx + 1}
                totalPages={pages.length}
              />
            </div>
          ));
        })}
      </div>

      <Dialog open={!!checkResult} onOpenChange={(o) => { if (!o) { setCheckResult(null); setPendingSave(null); setPendingPartial(null); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {checkTitle}
              {checkResult && (
                checkResult.errors.length > 0
                  ? <Badge variant="destructive" className="ml-2">오류 {checkResult.errors.length}</Badge>
                  : checkResult.warnings.length > 0
                  ? <Badge variant="secondary" className="ml-2">경고 {checkResult.warnings.length}</Badge>
                  : <Badge className="ml-2">통과</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {checkResult?.errors.length
                ? "오류가 있어 저장이 차단됩니다. 아래 항목을 수정 후 다시 시도하세요."
                : checkResult?.warnings.length
                ? "경고가 있습니다. 내용을 확인하고 진행 여부를 선택하세요."
                : "이상 없습니다."}
            </DialogDescription>
          </DialogHeader>
          {checkResult && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">전체 검사</div>
                <div className="text-base font-bold">{checkResult.findings.length}</div>
              </div>
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
                <div className="text-muted-foreground">오류</div>
                <div className="text-base font-bold text-destructive">{checkResult.errors.length}</div>
              </div>
              <div className="rounded-md border border-yellow-300 bg-yellow-50 p-2 dark:bg-yellow-950/30">
                <div className="text-muted-foreground">경고</div>
                <div className="text-base font-bold text-yellow-700 dark:text-yellow-300">{checkResult.warnings.length}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">정상</div>
                <div className="text-base font-bold">
                  {checkResult.findings.length === 0 ? "OK" : "-"}
                </div>
              </div>
            </div>
          )}
          <ScrollArea className="max-h-[360px] pr-3">
            <ul className="space-y-1 text-sm">
              {checkResult?.findings.map((f, i) => (
                <li
                  key={i}
                  className={
                    "rounded border px-2 py-1 " +
                    (f.severity === "error"
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : "border-yellow-300 bg-yellow-50 text-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-200")
                  }
                >
                  <span className="mr-1 font-semibold">{f.severity === "error" ? "오류" : "경고"}</span>
                  {f.message}
                </li>
              ))}
              {checkResult && checkResult.findings.length === 0 && (
                <li className="text-center text-muted-foreground">검사 완료 — 발견된 항목 없음</li>
              )}
            </ul>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCheckResult(null); setPendingSave(null); setPendingPartial(null); }}>
              닫기
            </Button>
            {pendingPartial && (
              <Button
                variant="secondary"
                onClick={() => {
                  const fn = pendingPartial.fn;
                  setCheckResult(null);
                  setPendingSave(null);
                  setPendingPartial(null);
                  fn();
                }}
              >
                {pendingPartial.label}
              </Button>
            )}
            {pendingSave && (
              <Button
                onClick={() => {
                  const fn = pendingSave;
                  setCheckResult(null);
                  setPendingSave(null);
                  setPendingPartial(null);
                  fn();
                }}
              >
                경고 확인 후 저장 진행
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!bulkResult} onOpenChange={(o) => { if (!o) setBulkResult(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>전체저장 결과</DialogTitle>
            <DialogDescription>{bulkResult?.filename}</DialogDescription>
          </DialogHeader>
          {bulkResult && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-md border p-2">
                  <div className="text-muted-foreground">등록 업체</div>
                  <div className="text-base font-bold">{companyStmts.length}</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-muted-foreground">등록 팀장</div>
                  <div className="text-base font-bold">{leaderStmts.length}</div>
                </div>
                <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
                  <div className="text-muted-foreground">저장 완료</div>
                  <div className="text-base font-bold text-primary">{bulkResult.savedCount}</div>
                </div>
                <div className="rounded-md border border-yellow-300 bg-yellow-50 p-2 dark:bg-yellow-950/30">
                  <div className="text-muted-foreground">제외</div>
                  <div className="text-base font-bold text-yellow-700 dark:text-yellow-300">
                    {bulkResult.skippedCompanies.length + bulkResult.skippedLeaders.length}
                  </div>
                </div>
              </div>
              <ScrollArea className="max-h-[280px] pr-3">
                <div className="space-y-3 text-sm">
                  {bulkResult.skippedCompanies.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold text-muted-foreground">제외 업체</div>
                      <ul className="space-y-1">
                        {bulkResult.skippedCompanies.map((x) => (
                          <li key={x.name} className="flex justify-between rounded border border-yellow-300 bg-yellow-50 px-2 py-1 dark:bg-yellow-950/30">
                            <span>{x.name}</span>
                            <span className="text-xs text-muted-foreground">{x.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {bulkResult.skippedLeaders.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold text-muted-foreground">제외 팀장</div>
                      <ul className="space-y-1">
                        {bulkResult.skippedLeaders.map((x) => (
                          <li key={x.name} className="flex justify-between rounded border border-yellow-300 bg-yellow-50 px-2 py-1 dark:bg-yellow-950/30">
                            <span>{x.name}</span>
                            <span className="text-xs text-muted-foreground">{x.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
          <DialogFooter>
            <Button onClick={() => setBulkResult(null)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// 미리보기 (간단 요약 + 행 목록) — 실제 PNG 디자인은 STEP 2에서 별도 컴포넌트로 분리
// ───────────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={"rounded-md border p-2 text-center " + (accent ? "border-primary bg-primary/5" : "")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{typeof value === "number" ? fmt(value) : value}</div>
    </div>
  );
}

/** rowCount 를 pageSize 단위로 잘라 [start, end) 범위 배열을 반환. 0건이면 1페이지(빈) 반환 */
function GateButton({
  reason, disabled, onClick, children, variant,
}: {
  reason: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "secondary";
}) {
  const btn = (
    <Button
      size="lg"
      className="h-14 w-full"
      variant={variant}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
  if (!reason) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block w-full">{btn}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function paginate(rowCount: number, pageSize: number): Array<{ start: number; end: number }> {
  if (rowCount <= 0) return [{ start: 0, end: 0 }];
  const out: Array<{ start: number; end: number }> = [];
  for (let s = 0; s < rowCount; s += pageSize) {
    out.push({ start: s, end: Math.min(s + pageSize, rowCount) });
  }
  return out;
}

function CompanyPreview({
  data,
  rowsSlice,
  pageIndex,
  totalPages,
}: {
  data: ReturnType<typeof buildCompanyStatements>[number];
  rowsSlice?: { start: number; end: number };
  pageIndex?: number;
  totalPages?: number;
}) {
  const c = data.company;
  const rows = rowsSlice ? data.rows.slice(rowsSlice.start, rowsSlice.end) : data.rows;
  const issuesInvoice = !!c.issues_invoice;
  // 업체 설정의 착불유무가 우선. 설정에서 미사용이면 착불/이월착불 라인을 표시하지 않음.
  const hasCod = (c.has_cod ?? true) && (data.codTotal + data.carryInCod) > 0;
  const claimTotal = data.finalClaim;

  // 기간 라벨: "기간: 2026년 05월 1~15일"
  const firstDate = data.rows[0]?.date ?? "";
  const ymMatch = firstDate.match(/^(\d{4})-(\d{2})/);
  const periodKR = data.period === "h1" ? "1~15일" : data.period === "h2" ? "16~말일" : "월전체";
  const periodLabel = ymMatch ? `기간: ${ymMatch[1]}년 ${ymMatch[2]}월 ${periodKR}` : `기간: ${periodKR}`;

  // 요약 라인 (분기별)
  const lines: Array<{ label: string; value: number; emphasize?: boolean }> = [];
  if (hasCod) {
    lines.push({ label: "착불", value: data.codTotal });
    lines.push({ label: "배송비", value: data.feeTotal });
    lines.push({ label: "이월착불", value: data.carryInCod });
  }
  lines.push({ label: "총합배송비", value: claimTotal, emphasize: !issuesInvoice });
  if (issuesInvoice) {
    lines.push({ label: "부가세", value: data.vat });
    lines.push({ label: "부가세포함총합", value: data.claimWithVat, emphasize: true });
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Statement</div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{c.name} <span className="text-muted-foreground font-medium">정산서</span></h2>
          <div className="mt-1 text-xs text-muted-foreground">{periodLabel}</div>
        </div>
        {totalPages && totalPages > 1 && (
          <div className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs tabular-nums text-muted-foreground">
            {pageIndex} / {totalPages}
          </div>
        )}
      </div>
      {data.errors.length > 0 && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {data.errors.map((e, i) => (<div key={i}>• {e}</div>))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-xl border border-border/60 bg-gradient-to-br from-muted/30 to-transparent">
          <table className="w-full text-base">
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.label} className={"border-b border-border/40 last:border-b-0 " + (ln.emphasize ? "bg-primary/5" : "")}>
                  <td className="px-4 py-3 font-medium text-muted-foreground">{ln.label}</td>
                  <td className={"px-4 py-3 text-right tabular-nums " + (ln.label === "총합배송비" || ln.label === "부가세포함총합" ? "text-xl font-bold text-red-600" : ln.emphasize ? "text-lg font-bold text-primary" : "font-semibold")}>
                    {fmt(ln.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {c.account_number && (
          <div className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/5 to-transparent p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Account</div>
            <div className="mt-1 text-lg font-bold tracking-tight">{c.account_number}</div>
            <div className="mt-2 text-xs text-muted-foreground">정산 완료 후 입금자명을 전달 부탁드립니다.</div>
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60">
        <table className="w-full text-xs border-collapse" style={{ tableLayout: "fixed", minWidth: 1280 }}>
          <colgroup>
            {[70,160,110,110,150,180,220,120,100].map((w,i)=>(<col key={i} style={{ width: w }} />))}
          </colgroup>
          <thead className="bg-muted/60">
            <tr>
              {["날짜","업체","팀장1","팀장2","고객명","품목","비고","배송비","결제유무"].map((h) => (
                <th key={h} className="px-2 py-2 text-center font-semibold uppercase tracking-wider text-[10px] text-muted-foreground whitespace-nowrap border-b border-border/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={"border-t border-border/40 " + (i % 2 === 1 ? "bg-muted/20" : "")}>
                <td className="px-2 py-1.5 text-center align-middle truncate tabular-nums">{r.date.slice(5)}</td>
                <td className="px-2 py-1.5 text-center align-middle truncate">{c.name}</td>
                <td className="px-2 py-1.5 text-center align-middle truncate">{r.display_leader1 ?? ""}</td>
                <td className="px-2 py-1.5 text-center align-middle truncate">{r.display_leader2 ?? ""}</td>
                <td className="px-2 py-1.5 text-center align-middle truncate">{r.customer_name ?? ""}</td>
                <td className="px-2 py-1.5 text-center align-middle break-words whitespace-normal">{r.item ?? ""}</td>
                <td className="px-2 py-1.5 text-center align-middle break-words whitespace-normal">{r.note ?? ""}</td>
                <td className="px-2 py-1.5 text-center align-middle tabular-nums font-medium">{fmt(r.delivery_fee)}</td>
                <td className="px-2 py-1.5 text-center align-middle">{r.paid ? "결제완료" : "미결제"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-4 text-center text-muted-foreground">데이터 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaderPreview({
  data,
  rowsSlice,
  pageIndex,
  totalPages,
}: {
  data: ReturnType<typeof buildLeaderStatements>[number];
  rowsSlice?: { start: number; end: number };
  pageIndex?: number;
  totalPages?: number;
}) {
  const l = data.leader;
  const rows = rowsSlice ? data.rows.slice(rowsSlice.start, rowsSlice.end) : data.rows;

  // 총합배송비 = 실지급액(payout) — 부가세 계산 기준과 100% 일치시켜
  // "총합배송비 + 부가세 = 부가세포함총배송비" 등식이 항상 성립하도록 한다.
  const issuesInvoice = !!l.issues_invoice;
  const vat = data.vat;
  const totalDelivery = data.payout;
  const totalWithVat = issuesInvoice ? data.payout + vat : data.payout;

  // 기간 라벨: "기간: 2026년 05월 1~15일"
  const firstDate = data.rows[0]?.delivery.date ?? "";
  const ymMatch = firstDate.match(/^(\d{4})-(\d{2})/);
  const periodKR = data.period === "h1" ? "1~15일" : data.period === "h2" ? "16~말일" : "월전체";
  const periodLabel = ymMatch ? `기간: ${ymMatch[1]}년 ${ymMatch[2]}월 ${periodKR}` : `기간: ${periodKR}`;

  // 상단바 라인 (분기별)
  const lines: Array<{ label: string; value: number; emphasize?: boolean }> = [
    { label: "수도권배송비", value: data.metroSum },
    { label: "비고금액", value: data.noteSum },
    { label: "지방배송비", value: data.regionalSum },
    { label: "수수료", value: data.feeTotal },
    { label: "착불", value: data.codSum },
    { label: "공제", value: data.deductionTotal },
    { label: "총합배송비", value: totalDelivery, emphasize: !issuesInvoice },
  ];
  if (issuesInvoice) {
    lines.push({ label: "부가세", value: vat });
    lines.push({ label: "부가세포함총배송비", value: totalWithVat, emphasize: true });
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Leader Statement</div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{l.name} <span className="text-muted-foreground font-medium">정산서</span></h2>
          <div className="mt-1 text-xs text-muted-foreground">{periodLabel}</div>
        </div>
        {totalPages && totalPages > 1 && (
          <div className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs tabular-nums text-muted-foreground">
            {pageIndex} / {totalPages}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-xl border border-border/60 bg-gradient-to-br from-muted/30 to-transparent">
          <table className="w-full text-base">
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.label} className={"border-b border-border/40 last:border-b-0 " + (ln.emphasize ? "bg-primary/5" : "")}>
                  <td className="px-4 py-3 font-medium text-muted-foreground">{ln.label}</td>
                  <td className={"px-4 py-3 text-right tabular-nums " + (ln.label === "총합배송비" || ln.label === "부가세포함총배송비" ? "text-xl font-bold text-red-600" : ln.emphasize ? "text-lg font-bold text-primary" : "font-semibold")}>
                    {fmt(ln.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {l.account_number && (
          <div className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/5 to-transparent p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Account</div>
            <div className="mt-1 text-lg font-bold tracking-tight">{l.account_number}</div>
            <div className="mt-2 text-xs text-muted-foreground">정산 완료 후 입금자명을 전달 부탁드립니다.</div>
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-border/60">
        <table className="w-full text-xs border-collapse" style={{ tableLayout: "fixed", minWidth: 1180 }}>
          <colgroup>
            {[80, 140, 160, 60, 180, 160, 100, 100, 100, 100].map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead className="bg-muted/60">
            <tr>
              {["날짜", "업체", "품목", "2인", "동행팀장", "비고", "수도권배송비", "비고금액", "지방배송비", "착불"].map((h) => (
                <th key={h} className="px-2 py-2 text-center font-semibold uppercase tracking-wider text-[10px] text-muted-foreground whitespace-nowrap border-b border-border/60">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const d = r.delivery;
              const partners = [d.leader1_name, d.leader2_name, d.leader3_name]
                .filter((n): n is string => !!n && n.trim() !== "" && n !== l.name);
              return (
              <tr key={r.delivery.id + "-" + i} className={"border-t border-border/40 " + (i % 2 === 1 ? "bg-muted/20" : "")}>
                <td className="px-2 py-1.5 text-center align-middle truncate tabular-nums">{r.delivery.date.slice(5)}</td>
                <td className="px-2 py-1.5 text-center align-middle truncate">{r.delivery.company_name ?? ""}</td>
                <td className="px-2 py-1.5 text-center align-middle break-words whitespace-normal">{r.delivery.item ?? ""}</td>
                <td className="px-2 py-1.5 text-center align-middle">
                  {d.two_person ? <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">2인</span> : ""}
                </td>
                <td className="px-2 py-1.5 text-center align-middle break-words whitespace-normal text-foreground">
                  {partners.length > 0 ? partners.join(", ") : ""}
                </td>
                <td className="px-2 py-1.5 text-center align-middle break-words whitespace-normal">{r.delivery.note ?? ""}</td>
                <td className="px-2 py-1.5 text-center align-middle tabular-nums">{fmt(r.share.metro)}</td>
                <td className="px-2 py-1.5 text-center align-middle tabular-nums">{fmt(r.share.note_amount)}</td>
                <td className="px-2 py-1.5 text-center align-middle tabular-nums">{fmt(r.share.regional)}</td>
                <td className="px-2 py-1.5 text-center align-middle tabular-nums">{fmt(r.share.cod)}</td>
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-2 py-4 text-center text-muted-foreground">데이터 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}