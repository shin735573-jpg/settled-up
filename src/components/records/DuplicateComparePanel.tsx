import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { recordMergeLog } from "@/lib/mergeLog";
import {
  type DupDelivery,
  findDuplicateSuspects,
  classifySuspect,
  recommendAction,
  sumMergedAmounts,
  validateMergePlan,
  mapDuplicateError,
  SUSPECT_STATUS_LABEL,
  type SuspectStatus,
  type MergePlanItem,
} from "@/lib/duplicateCheck";

type Row = DupDelivery & {
  id: string;
  leader1_name?: string | null;
  leader2_name?: string | null;
  company_name?: string | null;
  companion_reason?: string | null;
};

type MergeMode = "none" | "companion" | "two_person" | "keep_separate";
type AmountMode = "sum" | "manual" | undefined;

function nrm(v: unknown) { return String(v ?? "").trim(); }
function n(v: unknown) {
  if (v == null || v === "") return 0;
  const x = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
}
function feeTotal(r: Row) { return n(r.metro_fee) + n(r.note_amount) + n(r.regional_fee); }
function fmt(v: number) { return v.toLocaleString("ko-KR"); }

const STATUS_VARIANT: Record<SuspectStatus, "default" | "destructive" | "secondary" | "outline"> = {
  exact: "destructive",
  similar: "default",
  note_similar: "secondary",
  leader_missing: "destructive",
  companion_candidate: "default",
  two_person_candidate: "default",
  two_person_mismatch: "destructive",
  companion_needed: "secondary",
  settlement_mismatch: "destructive",
  reference: "outline",
};

function StatusBadges({ tags }: { tags: SuspectStatus[] }) {
  if (!tags.length) return <Badge variant="outline">정상</Badge>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} variant={STATUS_VARIANT[t]} className="text-[10px] whitespace-nowrap">
          {SUSPECT_STATUS_LABEL[t]}
        </Badge>
      ))}
    </div>
  );
}

const COMPARE_FIELDS: Array<{ key: keyof Row | "total" | "status"; label: string; type?: "amount" | "bool"; }> = [
  { key: "date", label: "날짜" },
  { key: "company_name", label: "업체" },
  { key: "customer_name", label: "고객명" },
  { key: "region", label: "배송지" },
  { key: "item", label: "품목" },
  { key: "note", label: "비고" },
  { key: "leader1_name", label: "팀장1" },
  { key: "leader2_name", label: "팀장2" },
  { key: "companion", label: "동행", type: "bool" },
  { key: "two_person", label: "2인배송", type: "bool" },
  { key: "split_type", label: "분할" },
  { key: "metro_fee", label: "수도권비", type: "amount" },
  { key: "regional_fee", label: "지방비", type: "amount" },
  { key: "note_amount", label: "비고금액", type: "amount" },
  { key: "cod_amount", label: "착불", type: "amount" },
  { key: "total", label: "총 청구금액", type: "amount" },
  { key: "status", label: "상태" },
];

function valueOf(r: Row, key: string): { display: string; raw: unknown } {
  if (key === "total") {
    const v = feeTotal(r);
    return { display: fmt(v), raw: v };
  }
  const raw = (r as Record<string, unknown>)[key];
  if (raw == null || raw === "") return { display: "—", raw: "" };
  if (typeof raw === "boolean") return { display: raw ? "예" : "아니오", raw };
  if (typeof raw === "number") return { display: fmt(raw), raw };
  return { display: String(raw), raw: String(raw) };
}

export type DuplicateComparePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: Row | null;
  allRows: Row[];
  onSaved?: () => void;
};

export function DuplicateComparePanel({ open, onOpenChange, base, allRows, onSaved }: DuplicateComparePanelProps) {
  const [edited, setEdited] = useState<Row | null>(null);
  const [selectedSuspectIds, setSelectedSuspectIds] = useState<Set<string>>(new Set());
  const [mergeMode, setMergeMode] = useState<MergeMode>("none");
  const [amountMode, setAmountMode] = useState<AmountMode>(undefined);
  const [manualTotal, setManualTotal] = useState<string>("");
  const [companionReason, setCompanionReason] = useState<string>("");
  const [tab, setTab] = useState<"exact" | "similar" | "note_similar">("exact");
  const [askAmount, setAskAmount] = useState<MergeMode | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // 통합 저장 직전 "최종 청구금액 확인" 단계
  const [amountConfirmOpen, setAmountConfirmOpen] = useState(false);
  const [editingFinalAmount, setEditingFinalAmount] = useState(false);
  const [finalAmountInput, setFinalAmountInput] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // 좌우 비교 패널에서 사용자가 개별 닫기한 의심 행 id 목록
  const [hiddenSuspectIds, setHiddenSuspectIds] = useState<Set<string>>(new Set());
  // 좌우 비교에서 현재 "포커스" 된 패널 id (강조 표시용). null 이면 기준 패널.
  const [focusPanelId, setFocusPanelId] = useState<string | null>(null);

  // 기준이 바뀌면 상태 초기화
  useEffect(() => {
    if (!base) { setEdited(null); return; }
    setEdited({ ...base });
    setSelectedSuspectIds(new Set());
    setMergeMode("none");
    setAmountMode(undefined);
    setManualTotal(String(feeTotal(base) || ""));
    setCompanionReason(base.companion_reason || "");
    setTab("exact");
    setHiddenSuspectIds(new Set());
    setFocusPanelId(null);
  }, [base?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const suspects = useMemo(() => {
    if (!edited) return { exact: [], similar: [], noteSimilar: [], reference: [] };
    return findDuplicateSuspects(edited, allRows as DupDelivery[]);
  }, [edited, allRows]);

  const activeList = tab === "exact" ? suspects.exact : tab === "similar" ? suspects.similar : suspects.noteSimilar;
  const refList = suspects.reference;

  const selectedSuspects: Row[] = useMemo(() => {
    return allRows.filter((r) => selectedSuspectIds.has(r.id));
  }, [allRows, selectedSuspectIds]);

  // 합산 미리보기
  const autoSum = useMemo(() => {
    if (!edited) return null;
    return sumMergedAmounts([edited, ...selectedSuspects]);
  }, [edited, selectedSuspects]);

  function toggleSuspect(id: string) {
    setSelectedSuspectIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function applyMergeMode(mode: MergeMode) {
    setMergeMode(mode);
    // 2인배송 통합: 사용자가 별도 입력 없이 두 가지가 자동 반영됨.
    //  - two_person = true
    //  - leader2 비어있으면 선택된 의심 행의 leader1 중 base.leader1과 다른 것으로 자동 채움
    //  - split_type 비어있으면 "반반"
    if (mode === "two_person") {
      setEdited((e) => {
        if (!e) return e;
        const next: Row = { ...e, two_person: true, companion: false };
        if (!nrm(next.leader2_id)) {
          // 선택된 의심행이 없으면 표시 중인 모든 의심행에서 자동 추론
          const pool: Row[] = selectedSuspects.length > 0
            ? selectedSuspects
            : ([...suspects.exact, ...suspects.similar] as Row[]);
          const candidates = pool
            .map((s) => ({ id: s.leader1_id, name: s.leader1_name }))
            .filter((c) => nrm(c.id) && c.id !== next.leader1_id);
          if (candidates[0]?.id) {
            next.leader2_id = candidates[0].id;
            next.leader2_name = candidates[0].name ?? next.leader2_name ?? null;
          }
        }
        if (!nrm(next.split_type)) next.split_type = "반반";
        return next;
      });
    }
    if (mode === "companion") {
      setEdited((e) => e ? { ...e, companion: true, two_person: false } : e);
    }
    if (mode === "companion" || mode === "two_person") {
      // 기본은 자동 합산. 사용자가 청구금액을 바꾸고 싶을 때만 수동 선택.
      setAmountMode("sum");
      setEdited((e) => {
        if (!e) return e;
        const sum = sumMergedAmounts([e, ...selectedSuspects]);
        return {
          ...e,
          metro_fee: sum.metro_fee,
          note_amount: sum.note_amount,
          regional_fee: sum.regional_fee,
          cod_amount: sum.cod_amount,
        };
      });
      setManualTotal(String(sumMergedAmounts([edited!, ...selectedSuspects]).total || ""));
      setAskAmount(null);
    } else {
      setAmountMode(undefined);
    }
  }

  function confirmAmountChoice(choice: "sum" | "manual") {
    setAmountMode(choice);
    if (choice === "sum" && autoSum) {
      setEdited((e) => e ? {
        ...e,
        metro_fee: autoSum.metro_fee,
        note_amount: autoSum.note_amount,
        regional_fee: autoSum.regional_fee,
        cod_amount: autoSum.cod_amount,
      } : e);
      setManualTotal(String(autoSum.total));
    }
    setAskAmount(null);
  }

  // 최종 적용 계획 (선택된 기준행 + 통합된 suspect들 → keep_separate)
  const plan: MergePlanItem[] = useMemo(() => {
    if (!edited || !base) return [];
    const items: MergePlanItem[] = [];
    const action = mergeMode === "companion" ? "merge_companion"
      : mergeMode === "two_person" ? "merge_two_person"
      : mergeMode === "keep_separate" ? "keep_separate"
      : "edit";
    const next: Row = { ...edited };
    if (action === "merge_companion") {
      next.companion = true;
      next.two_person = false;
      (next as Row).companion_reason = companionReason || null;
    }
    if (action === "merge_two_person") {
      next.two_person = true;
      next.companion = false;
      if (!nrm(next.split_type)) next.split_type = "반반";
      if (!nrm(next.leader2_id)) {
        const pool: Row[] = selectedSuspects.length > 0
          ? selectedSuspects
          : ([...suspects.exact, ...suspects.similar] as Row[]);
        const cand = pool
          .map((s) => ({ id: s.leader1_id, name: s.leader1_name }))
          .find((c) => nrm(c.id) && c.id !== next.leader1_id);
        if (cand?.id) {
          next.leader2_id = cand.id;
          next.leader2_name = cand.name ?? next.leader2_name ?? null;
        }
      }
    }
    items.push({
      base: base as DupDelivery,
      next: next as DupDelivery,
      action,
      amountMode,
      manualTotal: amountMode === "manual" ? n(manualTotal) : null,
    });
    return items;
  }, [edited, base, mergeMode, amountMode, manualTotal, companionReason]);

  const errors = useMemo(() => validateMergePlan(plan), [plan]);
  const hasBlocking = errors.some((e) => e.level === "error");

  async function save() {
    if (!edited || !base) return;
    if (hasBlocking) {
      toast.error("저장 전 오류를 먼저 해결해주세요.");
      return;
    }
    // 최종 유효성 재확인 (자동 반영 후에도 누락된 부분이 없는지)
    const finalErrors = validateMergePlan(plan);
    const finalBlocking = finalErrors.filter((e) => e.level === "error");
    if (finalBlocking.length > 0) {
      toast.error(`저장 불가: ${finalBlocking[0].message}`);
      return;
    }
    if (mergeMode === "two_person") {
      if (!edited.two_person) {
        toast.error("2인배송 통합인데 '2인배송 여부'가 꺼져 있습니다.");
        return;
      }
      if (!nrm(edited.leader2_id)) {
        toast.error("2인배송 통합인데 팀장2가 비어 있습니다. 의심행을 선택하거나 팀장2를 직접 지정하세요.");
        return;
      }
    }
    if (mergeMode === "companion" && !edited.companion) {
      toast.error("동행 통합인데 '동행여부'가 꺼져 있습니다.");
      return;
    }
    setSaving(true);
    try {
      const update = {
        date: edited.date,
        company_id: edited.company_id ?? null,
        company_name: edited.company_name ?? null,
        customer_name: edited.customer_name ?? null,
        region: edited.region ?? null,
        item: edited.item ?? null,
        note: edited.note ?? null,
        leader1_id: edited.leader1_id ?? null,
        leader2_id: edited.leader2_id ?? null,
        split_type: edited.split_type ?? null,
        two_person: !!edited.two_person,
        companion: !!edited.companion,
        companion_reason: edited.companion_reason ?? null,
        metro_fee: n(edited.metro_fee),
        regional_fee: n(edited.regional_fee),
        note_amount: n(edited.note_amount),
        cod_amount: n(edited.cod_amount),
        paid: !!edited.paid,
      } as never;
      // 기존 row update — 절대 insert 하지 않음
      const { error } = await supabase.from("deliveries").update(update).eq("id", base.id);
      if (error) {
        const friendly = mapDuplicateError(error);
        toast.error(friendly || `저장 실패: ${error.message}`);
        return;
      }
      // 통합 = 2개가 1개로 합쳐짐. 선택된 의심행은 실제로 삭제.
      let mergedDeleted = 0;
      if ((mergeMode === "companion" || mergeMode === "two_person") && selectedSuspects.length > 0) {
        const ids = selectedSuspects.map((s) => s.id).filter((id) => id && id !== base.id);
        if (ids.length > 0) {
          // 통합 이력 저장 (복구용 스냅샷) — 삭제 전에 기록
          const mergedSnapshots = selectedSuspects.filter((s) => ids.includes(s.id));
          const { data: u } = await supabase.auth.getUser();
          if (u?.user?.id) {
            await recordMergeLog({
              userId: u.user.id,
              baseRowId: base.id,
              action: mergeMode === "companion" ? "merge_companion" : "merge_two_person",
              baseBefore: base as unknown as Record<string, unknown> & { id: string },
              baseAfter: { ...(edited as unknown as Record<string, unknown>), id: base.id },
              mergedRows: mergedSnapshots as unknown as Array<Record<string, unknown> & { id: string }>,
            });
          }
          const { error: delErr } = await supabase.from("deliveries").delete().in("id", ids);
          if (delErr) {
            toast.error("통합 중복 행 삭제 실패: " + delErr.message);
            return;
          }
          mergedDeleted = ids.length;
        }
      }
      toast.success(
        mergedDeleted > 0
          ? `통합 완료 · 1건으로 합쳐짐 (삭제 ${mergedDeleted}건)`
          : "저장 완료",
      );
      setReviewOpen(false);
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!base || !edited) return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[920px] overflow-y-auto">
        <SheetHeader><SheetTitle>배송내역 상세</SheetTitle></SheetHeader>
        <div className="p-6 text-sm text-muted-foreground">기록을 선택하세요.</div>
      </SheetContent>
    </Sheet>
  );

  const baseTags = ["정상"];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-[1100px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>배송내역 상세 · 중복의심 비교/통합</SheetTitle>
            <SheetDescription>선택한 1건을 기준으로 같은 user의 기록에서 중복의심을 검색합니다. 저장은 기존 row 업데이트로 처리됩니다.</SheetDescription>
          </SheetHeader>

          {/* 기준 행 요약 */}
          <div className="mt-4 rounded-md border p-3 bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">기준 기록</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div><span className="text-muted-foreground">날짜</span> {nrm(edited.date) || "—"}</div>
              <div><span className="text-muted-foreground">업체</span> {nrm(edited.company_name) || "—"}</div>
              <div><span className="text-muted-foreground">고객</span> {nrm(edited.customer_name) || "—"}</div>
              <div><span className="text-muted-foreground">배송지</span> {nrm(edited.region) || "—"}</div>
              <div className="col-span-2"><span className="text-muted-foreground">품목</span> {nrm(edited.item) || "—"}</div>
              <div className="col-span-2"><span className="text-muted-foreground">비고</span> {nrm(edited.note) || "—"}</div>
            </div>
          </div>

          {/* 사용자가 체크할 항목 */}
          <div className="mt-4 rounded-md border p-3">
            <div className="text-sm font-medium mb-2">속성 확인/수정</div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={!!edited.companion} onCheckedChange={(v) => setEdited((e) => e ? { ...e, companion: !!v } : e)} />
                동행여부
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={!!edited.two_person} onCheckedChange={(v) => setEdited((e) => e ? { ...e, two_person: !!v } : e)} />
                2인배송 여부
              </label>
              <label className="flex items-center gap-2">
                <span>분할</span>
                <select
                  className="border rounded px-2 py-1 text-sm bg-background"
                  value={nrm(edited.split_type)}
                  onChange={(ev) => setEdited((e) => e ? { ...e, split_type: ev.target.value || null } : e)}
                >
                  <option value="">—</option>
                  <option value="반반">반반</option>
                  <option value="팀장1">팀장1</option>
                  <option value="팀장2">팀장2</option>
                </select>
              </label>
            </div>
            {!!edited.two_person && !nrm(edited.leader2_id) && (
              <Alert variant="destructive" className="mt-2 py-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">2인배송인데 팀장2가 비어 있습니다. 좌측 목록에서 행을 편집해 팀장2를 지정하세요.</AlertDescription>
              </Alert>
            )}
          </div>

          {/* 통합여부 선택 */}
          <div className="mt-4 rounded-md border p-3">
            <div className="text-sm font-medium mb-2">통합여부</div>
            <RadioGroup value={mergeMode} onValueChange={(v) => applyMergeMode(v as MergeMode)} className="flex flex-wrap gap-4">
              {([
                ["none", "통합 안 함"],
                ["companion", "동행 통합"],
                ["two_person", "2인배송 통합"],
                ["keep_separate", "별도 기록 유지"],
              ] as const).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={v} id={`mm-${v}`} />
                  <span>{label}</span>
                </label>
              ))}
            </RadioGroup>
            {mergeMode === "two_person" && (
              <div className="mt-3 rounded-md border border-violet-300 bg-violet-50 p-2 text-xs text-violet-900">
                <div className="font-medium mb-1">2인배송 통합 자동 반영 상태</div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={edited.two_person ? "default" : "destructive"}>
                    2인배송 {edited.two_person ? "ON ✔" : "OFF ✗"}
                  </Badge>
                  <Badge variant={nrm(edited.leader2_id) ? "default" : "destructive"}>
                    팀장2 {nrm(edited.leader2_id) ? `✔ ${edited.leader2_name || edited.leader2_id?.slice(0, 8)}` : "✗ 자동 추론 실패"}
                  </Badge>
                  <Badge variant={nrm(edited.split_type) === "반반" ? "default" : "secondary"}>
                    분할 {nrm(edited.split_type) || "—"}
                  </Badge>
                  <Badge variant={amountMode ? "default" : "secondary"}>
                    금액 {amountMode === "sum" ? "자동 합산 ✔" : amountMode === "manual" ? "직접입력" : "미선택"}
                  </Badge>
                </div>
                {!nrm(edited.leader2_id) && (
                  <div className="mt-2 text-[11px]">
                    의심행에서 다른 팀장1을 찾지 못했습니다. 의심행을 선택하거나 위 "속성 확인/수정"에서 직접 팀장2를 지정해주세요.
                  </div>
                )}
              </div>
            )}
            {mergeMode === "companion" && (
              <div className="mt-3 rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-900">
                <div className="font-medium mb-1">동행 통합 자동 반영 상태</div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={edited.companion ? "default" : "destructive"}>
                    동행 {edited.companion ? "ON ✔" : "OFF ✗"}
                  </Badge>
                  <Badge variant={!edited.two_person ? "default" : "secondary"}>
                    2인배송 {edited.two_person ? "ON" : "OFF ✔"}
                  </Badge>
                  <Badge variant={amountMode ? "default" : "secondary"}>
                    금액 {amountMode === "sum" ? "자동 합산 ✔" : amountMode === "manual" ? "직접입력" : "미선택"}
                  </Badge>
                </div>
              </div>
            )}
            {amountMode && (
              <div className="mt-3 text-xs text-muted-foreground">
                금액 처리: <Badge variant="secondary">{amountMode === "sum" ? "자동 합산" : "직접입력"}</Badge>
                {amountMode === "manual" && (
                  <span className="ml-2 inline-flex items-center gap-2">
                    <Label className="text-xs">청구금액</Label>
                    <Input value={manualTotal} onChange={(e) => setManualTotal(e.target.value)} className="h-7 w-32 inline" />
                  </span>
                )}
                {amountMode === "sum" && autoSum && (
                  <span className="ml-2">합계 {fmt(autoSum.total)}원</span>
                )}
              </div>
            )}
          </div>

          {/* 중복의심 검색 결과 */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">중복 의심 검색 결과</div>
              <div className="text-xs text-muted-foreground">
                완전 {suspects.exact.length} · 유사 {suspects.similar.length} · 비고 {suspects.noteSimilar.length} · 참고 {refList.length}
              </div>
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="exact">완전 일치 ({suspects.exact.length})</TabsTrigger>
                <TabsTrigger value="similar">유사 건 ({suspects.similar.length})</TabsTrigger>
                <TabsTrigger value="note_similar">비고 유사 ({suspects.noteSimilar.length})</TabsTrigger>
              </TabsList>
              <TabsContent value={tab} className="mt-2">
                {(() => {
                  const visibleSuspects = (activeList as Row[]).filter((s) => !hiddenSuspectIds.has(s.id));
                  // 좌우 패널: 기준 1 + 의심 최대 5 = 총 6개
                  const MAX_PANELS = 6;
                  const suspectPanels = visibleSuspects.slice(0, MAX_PANELS - 1);
                  const overflowCount = visibleSuspects.length - suspectPanels.length;
                  return activeList.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-3 border rounded">해당 카테고리의 의심 기록이 없습니다.</div>
                ) : (
                  <div className="space-y-2">
                    {overflowCount > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        의심 {visibleSuspects.length}건 중 {suspectPanels.length}건 표시 (최대 6개 패널 비교).
                        남은 {overflowCount}건은 다른 패널을 닫으면 자동으로 보입니다.
                      </div>
                    )}
                    {hiddenSuspectIds.size > 0 && (
                      <button
                        type="button"
                        className="text-[11px] underline text-muted-foreground"
                        onClick={() => setHiddenSuspectIds(new Set())}
                      >
                        닫은 패널 {hiddenSuspectIds.size}개 복구
                      </button>
                    )}
                    <div className="overflow-x-auto border rounded bg-muted/10">
                      <div className="flex gap-2 p-2 min-w-min">
                        {/* 기준 패널 */}
                        {(() => {
                          const isFocus = focusPanelId === null;
                          return (
                            <div
                              className={
                                "shrink-0 w-[260px] rounded border bg-card transition " +
                                (isFocus ? "ring-2 ring-primary border-primary" : "border-border")
                              }
                              onClick={() => setFocusPanelId(null)}
                            >
                              <div className="flex items-center justify-between px-2 py-1.5 border-b bg-primary/5">
                                <Badge variant="default" className="text-[10px]">기준</Badge>
                                <span className="text-[10px] text-muted-foreground">선택한 1건</span>
                              </div>
                              <table className="w-full text-xs">
                                <tbody>
                                  {COMPARE_FIELDS.map((f) => {
                                    if (f.key === "status") {
                                      return (
                                        <tr key="status" className="border-t">
                                          <td className="px-2 py-1 text-muted-foreground w-[80px]">{f.label}</td>
                                          <td className="px-2 py-1"><StatusBadges tags={[]} /></td>
                                        </tr>
                                      );
                                    }
                                    const { display } = valueOf(edited, String(f.key));
                                    return (
                                      <tr key={String(f.key)} className="border-t">
                                        <td className="px-2 py-1 text-muted-foreground w-[80px]">{f.label}</td>
                                        <td className="px-2 py-1 break-words">{display}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                        {/* 의심 패널들 (좌→우) */}
                        {suspectPanels.map((s, idx) => {
                          const tags = classifySuspect(edited, s as DupDelivery);
                          const rec = recommendAction(edited, s as DupDelivery);
                          const checked = selectedSuspectIds.has(s.id);
                          const isFocus = focusPanelId === s.id;
                          return (
                            <div
                              key={s.id}
                              className={
                                "shrink-0 w-[260px] rounded border bg-card transition " +
                                (isFocus ? "ring-2 ring-amber-400 border-amber-400" : checked ? "border-amber-300" : "border-border")
                              }
                              onClick={() => setFocusPanelId(s.id)}
                            >
                              <div className="flex items-center justify-between px-2 py-1.5 border-b bg-muted/30">
                                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => toggleSuspect(s.id)}
                                  />
                                  의심 #{idx + 1}
                                </label>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  title="이 패널 닫기"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setHiddenSuspectIds((h) => {
                                      const n = new Set(h); n.add(s.id); return n;
                                    });
                                    setSelectedSuspectIds((sel) => {
                                      if (!sel.has(s.id)) return sel;
                                      const n = new Set(sel); n.delete(s.id); return n;
                                    });
                                    if (focusPanelId === s.id) setFocusPanelId(null);
                                  }}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              <table className="w-full text-xs">
                                <tbody>
                                  {COMPARE_FIELDS.map((f) => {
                                    if (f.key === "status") {
                                      return (
                                        <tr key="status" className="border-t">
                                          <td className="px-2 py-1 text-muted-foreground w-[80px]">{f.label}</td>
                                          <td className="px-2 py-1">
                                            <StatusBadges tags={tags} />
                                            {rec !== "none" && (
                                              <div className="text-[10px] text-muted-foreground mt-1">
                                                추천: {rec === "merge_two_person" ? "2인배송 통합" : rec === "merge_companion" ? "동행 통합" : rec === "dedupe" ? "중복 제거" : "별도 유지"}
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    }
                                    const cur = valueOf(s, String(f.key));
                                    const baseVal = valueOf(edited, String(f.key));
                                    const diff = String(cur.raw) !== String(baseVal.raw);
                                    const missing = (f.key === "leader2_name" || f.key === "leader1_name") && (cur.display === "—");
                                    const cls = missing ? "bg-red-100/60 text-red-700" : diff ? "bg-amber-100/40" : "";
                                    return (
                                      <tr key={String(f.key)} className="border-t">
                                        <td className="px-2 py-1 text-muted-foreground w-[80px]">{f.label}</td>
                                        <td className={`px-2 py-1 break-words ${cls}`}>{cur.display}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  );
                })()}
                {refList.length > 0 && tab !== "exact" && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    참고건(품목이 다른 같은 고객/배송지) {refList.length}건이 별도로 있습니다.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* 에러/경고 */}
          {errors.length > 0 && (
            <Alert variant={hasBlocking ? "destructive" : "default"} className="mt-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="text-xs list-disc pl-4">
                  {errors.map((e, i) => <li key={i}>[{e.level === "error" ? "오류" : "경고"}] {e.message}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
            <Button onClick={() => setReviewOpen(true)} disabled={saving}>
              저장 전 최종 확인
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 금액 처리 질문 */}
      <Dialog open={!!askAmount} onOpenChange={(o) => { if (!o) setAskAmount(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>각 팀장들 금액을 합산할까요?</DialogTitle>
            <DialogDescription>
              {askAmount === "two_person" ? "2인배송 통합" : "동행 통합"} 시 청구금액을 어떻게 처리할지 선택하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-2">
            <div className="text-muted-foreground">자동 합산 예상: <b>{autoSum ? fmt(autoSum.total) : 0}원</b> (선택된 의심 {selectedSuspects.length}건 포함)</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => confirmAmountChoice("manual")}>직접입력</Button>
            <Button onClick={() => confirmAmountChoice("sum")}>합산</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 최종 확인 */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>저장 전 최종 확인</DialogTitle>
            <DialogDescription>아래 내용으로 기존 row를 업데이트합니다. 새 row가 만들어지지 않습니다.</DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>수정 대상: <b>1건</b></div>
              <div>통합 방식: <b>{mergeMode === "none" ? "수정만" : mergeMode === "companion" ? "동행 통합" : mergeMode === "two_person" ? "2인배송 통합" : "별도 유지"}</b></div>
              <div>금액 처리: <b>{amountMode === "sum" ? "자동 합산" : amountMode === "manual" ? "직접입력" : "—"}</b></div>
              <div>최종 청구금액: <b>{fmt(feeTotal(edited))}원</b></div>
              <div>팀장2: <b>{nrm(edited.leader2_name) || nrm(edited.leader2_id) || "—"}</b></div>
              <div>분할: <b>{nrm(edited.split_type) || "—"}</b></div>
            </div>
            {edited.two_person && nrm(edited.split_type) === "반반" && (
              <div className="text-xs text-muted-foreground">기본 정산: 팀장1 {fmt(Math.round(feeTotal(edited) / 2))} · 팀장2 {fmt(Math.round(feeTotal(edited) / 2))}</div>
            )}
            {errors.length > 0 && (
              <Alert variant={hasBlocking ? "destructive" : "default"}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="text-xs list-disc pl-4">
                    {errors.map((e, i) => <li key={i}>[{e.level === "error" ? "오류" : "경고"}] {e.message}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {errors.length === 0 && (
              <div className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-4 w-4" /> 검증 통과</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={saving}>다시 수정</Button>
            <Button variant="outline" onClick={() => { setReviewOpen(false); onOpenChange(false); }} disabled={saving}>취소</Button>
            <Button
              onClick={() => {
                // 통합 모드인 경우 반드시 "최종 청구금액 확인" 단계를 거친다.
                if (mergeMode === "companion" || mergeMode === "two_person") {
                  setFinalAmountInput(String(feeTotal(edited) || 0));
                  setEditingFinalAmount(false);
                  setReviewOpen(false);
                  setAmountConfirmOpen(true);
                } else {
                  void save();
                }
              }}
              disabled={hasBlocking || saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {(mergeMode === "companion" || mergeMode === "two_person") ? "다음: 금액 확인" : "적용 저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 통합 저장 직전 — 최종 청구금액 확인 */}
      <Dialog open={amountConfirmOpen} onOpenChange={(o) => { if (!o && !saving) setAmountConfirmOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>최종 청구금액 확인</DialogTitle>
            <DialogDescription>
              {mergeMode === "two_person" ? "2인배송 통합" : "동행 통합"}으로 저장합니다.
              아래 최종 청구금액이 맞는지 반드시 확인해주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="rounded-lg border bg-primary/5 p-4">
              <div className="text-xs text-muted-foreground mb-1">최종 청구금액</div>
              {editingFinalAmount ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={finalAmountInput}
                    onChange={(e) => setFinalAmountInput(e.target.value)}
                    className="h-10 text-lg font-semibold"
                    autoFocus
                  />
                  <span className="text-sm">원</span>
                </div>
              ) : (
                <div className="text-2xl font-bold">
                  {fmt(n(finalAmountInput))}원
                </div>
              )}
            </div>
            {(() => {
              const total = n(finalAmountInput);
              const half = Math.round(total / 2);
              const isHalf = !!edited.two_person && nrm(edited.split_type) === "반반";
              const l1 = isHalf ? half : total;
              const l2 = isHalf ? total - half : 0;
              return (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">팀장1 정산금</div>
                    <div className="font-medium">
                      {nrm(edited.leader1_name) || "—"}
                    </div>
                    <div className="text-base">{fmt(l1)}원</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-muted-foreground">팀장2 정산금</div>
                    <div className="font-medium">
                      {nrm(edited.leader2_name) || (nrm(edited.leader2_id) ? edited.leader2_id?.slice(0, 8) : "—")}
                    </div>
                    <div className="text-base">{l2 ? `${fmt(l2)}원` : "—"}</div>
                  </div>
                </div>
              );
            })()}
            {!editingFinalAmount && (
              <div className="text-[11px] text-muted-foreground">
                금액이 다르면 "금액 수정"을 눌러 직접 입력 후 최종 저장하세요.
              </div>
            )}
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setAmountConfirmOpen(false)} disabled={saving}>취소</Button>
            {editingFinalAmount ? (
              <Button variant="outline" onClick={() => setEditingFinalAmount(false)} disabled={saving}>
                금액 적용
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setEditingFinalAmount(true)} disabled={saving}>
                금액 수정
              </Button>
            )}
            <Button
              onClick={async () => {
                if (editingFinalAmount) {
                  // 편집 중이면 먼저 금액을 확정만 하고 저장은 다시 누르도록
                  setEditingFinalAmount(false);
                  return;
                }
                // 입력된 최종 금액을 edited에 반영 (note_amount에 차액 흡수)
                const desired = n(finalAmountInput);
                const current = feeTotal(edited);
                if (desired !== current) {
                  const diff = desired - current;
                  setEdited((e) => e ? { ...e, note_amount: Math.max(0, n(e.note_amount) + diff) } : e);
                  // setState는 비동기이므로 save() 안에서 다시 한 번 반영된 값 사용
                  // 다음 tick에서 save 실행
                  await new Promise((r) => setTimeout(r, 0));
                }
                await save();
                setAmountConfirmOpen(false);
              }}
              disabled={saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              최종 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default DuplicateComparePanel;