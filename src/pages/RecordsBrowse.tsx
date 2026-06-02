import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { LeaderCombobox } from "@/components/LeaderCombobox";
import { Search, Pencil, AlertTriangle, Users, Trash2 } from "lucide-react";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  groupByLooseKey,
  classifyGroupRow,
  recommendAction,
  validateMergePlan,
  buildUpdatePatches,
  exactKey,
  totalFee,
  statusLabel,
  actionLabel,
  type GroupRow,
  type LooseGroup,
  type RowStatus,
  type RecommendedAction,
  type MergePlanItem,
} from "@/lib/recordGrouping";

type Leader = { id: string; name: string; active: boolean; is_virtual?: boolean; aliases?: string[] };

const monthStart = (m: string) => m + "-01";
const monthEndExclusive = (m: string) => {
  const d = new Date(m + "-01");
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

const STATUS_COLOR: Record<RowStatus, string> = {
  normal: "bg-emerald-100 text-emerald-700 border-emerald-200",
  exact_duplicate: "bg-red-100 text-red-700 border-red-200",
  suspect_duplicate: "bg-amber-100 text-amber-700 border-amber-200",
  leader2_missing: "bg-orange-100 text-orange-700 border-orange-200",
  two_person_mismatch: "bg-rose-100 text-rose-700 border-rose-200",
  companion_needed: "bg-sky-100 text-sky-700 border-sky-200",
};

const RECOMMEND_COLOR: Record<RecommendedAction, string> = {
  dedupe: "bg-red-50 border-red-300 text-red-700",
  merge_companion: "bg-sky-50 border-sky-300 text-sky-700",
  merge_two_person: "bg-violet-50 border-violet-300 text-violet-700",
  keep_separate: "bg-muted text-muted-foreground border",
};

type FilterStatus = "all" | RowStatus;

export default function RecordsBrowse() {
  const navigate = useNavigate();
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [records, setRecords] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [pendingActions, setPendingActions] = useState<Map<string, MergePlanItem>>(new Map());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 일괄 적용 모달
  const [bulkOpen, setBulkOpen] = useState<null | RecommendedAction>(null);
  const [bulkLeader2, setBulkLeader2] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkSplit, setBulkSplit] = useState("");

  // 직접 수정 폼
  const [editForm, setEditForm] = useState<GroupRow | null>(null);

  // 로드
  const reload = async () => {
    setLoading(true);
    const start = monthStart(filterMonth);
    const end = monthEndExclusive(filterMonth);
    const [{ data: dl }, { data: ll }] = await Promise.all([
      supabase
        .from("deliveries")
        .select("*")
        .gte("date", start)
        .lt("date", end)
        .order("date", { ascending: false })
        .limit(5000),
      supabase.from("team_leaders").select("id,name,active,is_virtual,aliases").order("name"),
    ]);
    setRecords((dl as GroupRow[]) || []);
    setLeaders(((ll as Leader[]) || []).filter((l) => l.active));
    setLoading(false);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMonth]);

  // 그룹 계산
  const groups: LooseGroup[] = useMemo(() => groupByLooseKey(records), [records]);

  // 검색/필터 적용
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (q) {
        const hay = [g.customer, g.region, g.item, g.date].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== "all") {
        const has = g.rows.some((r) => classifyGroupRow(r, g.rows).includes(statusFilter));
        if (!has) return false;
      }
      return true;
    });
  }, [groups, search, statusFilter]);

  const groupsByKey = useMemo(() => {
    const m = new Map<string, GroupRow[]>();
    for (const g of groups) m.set(g.key, g.rows);
    return m;
  }, [groups]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.key === selectedGroupKey) ?? null,
    [groups, selectedGroupKey],
  );

  // 행에 부여된 액션이 있으면 우선 표시
  const actionFor = (key: string) => pendingActions.get(key)?.action;

  // ─── 액션 핸들러 ──────────────────────────────────────
  const queueAction = (group: LooseGroup, action: RecommendedAction, extra?: Partial<MergePlanItem>) => {
    setPendingActions((prev) => {
      const m = new Map(prev);
      m.set(group.key, {
        groupKey: group.key,
        action,
        targetIds: group.rows.map((r) => r.id),
        ...extra,
      });
      return m;
    });
  };

  const clearAction = (key: string) => {
    setPendingActions((prev) => {
      const m = new Map(prev);
      m.delete(key);
      return m;
    });
  };

  // 중복 체크 (월 단위)
  const runDuplicateCheck = () => {
    let exact = 0, suspect = 0;
    for (const g of groups) {
      const keys = g.rows.map(exactKey);
      const uniq = new Set(keys);
      if (uniq.size < keys.length) exact++;
      else suspect++;
    }
    toast.info(`검사 완료 · 그룹 ${groups.length}건 (정확중복 ${exact} / 유사중복 ${suspect})`);
  };

  // 일괄 적용
  const applyBulk = () => {
    if (!bulkOpen) return;
    const action = bulkOpen;
    const targets = visibleGroups.filter((g) => checkedKeys.has(g.key));
    if (!targets.length) {
      toast.error("좌측에서 그룹을 1개 이상 체크하세요.");
      return;
    }
    for (const g of targets) {
      queueAction(g, action, {
        companionReason: bulkReason || undefined,
        leader2Id: bulkLeader2 || undefined,
        splitType: bulkSplit || undefined,
      });
    }
    toast.success(`${targets.length}개 그룹에 ${actionLabel[action]} 예약됨`);
    setBulkOpen(null);
    setBulkLeader2(""); setBulkReason(""); setBulkSplit("");
  };

  // 최종 적용
  const applyAllChanges = async () => {
    const plan = [...pendingActions.values()];
    const patches = buildUpdatePatches(plan, groupsByKey);
    if (!patches.length) {
      toast.info("변경할 내용이 없습니다.");
      return;
    }
    setSaving(true);
    let ok = 0, fail = 0;
    for (const { id, patch } of patches) {
      const cleanPatch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (["metro_fee", "regional_fee", "note_amount", "cod_amount"].includes(k)) {
          cleanPatch[k] = Number(v as number | string) || 0;
        } else {
          cleanPatch[k] = v;
        }
      }
      const { error } = await supabase
        .from("deliveries")
        .update({ ...cleanPatch, updated_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) {
        fail++;
        if (error.code === "23505") {
          toast.error(`동일 내용이 이미 등록되어 있어 일부 건이 저장되지 않았습니다 (id ${id.slice(0, 8)})`);
        }
      } else ok++;
    }
    setSaving(false);
    setReviewOpen(false);
    setPendingActions(new Map());
    setCheckedKeys(new Set());
    toast.success(`적용 완료 · 성공 ${ok}건 / 실패 ${fail}건`);
    await reload();
  };

  const validateIssues = useMemo(() => {
    return validateMergePlan([...pendingActions.values()], groupsByKey);
  }, [pendingActions, groupsByKey]);

  // 직접 수정 저장
  const saveEdit = async () => {
    if (!editForm) return;
    setSaving(true);
    const { id, ...rest } = editForm;
    const { error } = await supabase
      .from("deliveries")
      .update({
        leader1_id: rest.leader1_id || null,
        leader2_id: rest.leader2_id || null,
        two_person: !!rest.two_person,
        companion: !!rest.companion,
        companion_reason: rest.companion_reason ?? null,
        split_type: rest.split_type ?? null,
        metro_fee: Number(rest.metro_fee) || 0,
        regional_fee: Number(rest.regional_fee) || 0,
        note_amount: Number(rest.note_amount) || 0,
        cod_amount: Number(rest.cod_amount) || 0,
        paid: !!rest.paid,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    setSaving(false);
    if (error) {
      if (error.code === "23505") toast.error("동일 내용이 이미 등록되어 있습니다.");
      else toast.error("저장 실패: " + error.message);
      return;
    }
    toast.success("저장 완료");
    setEditForm(null);
    await reload();
  };

  // 중복 제거 (그룹 내 완전중복 1건만 남기고 나머지 삭제)
  const dedupeGroup = async (group: LooseGroup) => {
    const seen = new Set<string>();
    const toDelete: string[] = [];
    for (const row of group.rows) {
      const k = exactKey(row);
      if (seen.has(k)) toDelete.push(row.id);
      else seen.add(k);
    }
    if (!toDelete.length) {
      toast.info("그룹 안에 완전중복이 없습니다.");
      return;
    }
    if (!window.confirm(`완전중복 ${toDelete.length}건을 삭제합니다. 진행할까요?`)) return;
    const { error } = await supabase.from("deliveries").delete().in("id", toDelete);
    if (error) toast.error("삭제 실패: " + error.message);
    else {
      toast.success(`${toDelete.length}건 삭제됨`);
      await reload();
    }
  };

  // ─── 렌더 ──────────────────────────────────────────────
  const checkedGroupCount = checkedKeys.size;
  const queuedCount = pendingActions.size;

  return (
    <div className="space-y-3">
      {/* 상단 툴바 */}
      <Card className="p-3 md:p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">월 선택</Label>
            <Input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="w-40 h-9"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label className="text-xs">검색 (고객/배송지/품목)</Label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="검색어"
                className="h-9 pl-7"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">상태 필터</Label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">전체</option>
              {(Object.keys(statusLabel) as RowStatus[]).map((k) => (
                <option key={k} value={k}>{statusLabel[k]}</option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={runDuplicateCheck} disabled={loading}>
            중복 체크
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={checkedGroupCount === 0}>
                일괄작업 ({checkedGroupCount}) ▾
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>선택 그룹 일괄 처리</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setBulkOpen("merge_companion")}>
                동행 통합
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBulkOpen("merge_two_person")}>
                2인배송 통합
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBulkOpen("keep_separate")}>
                별도 유지
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  for (const k of checkedKeys) clearAction(k);
                  toast.success("예약 액션 취소됨");
                }}
              >
                예약 액션 취소
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={() => setReviewOpen(true)}
            disabled={queuedCount === 0}
          >
            저장 전 검토 ({queuedCount})
          </Button>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          그룹 {groups.length}건 · 표시 {visibleGroups.length}건 · 예약 {queuedCount}건
          {loading && " · 불러오는 중…"}
        </div>
      </Card>

      {/* 2-패널 */}
      <div className="grid gap-3 lg:grid-cols-[420px_1fr]">
        {/* 좌측: 그룹 리스트 */}
        <Card className="p-2 max-h-[calc(100vh-220px)] overflow-y-auto">
          {visibleGroups.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              표시할 그룹이 없습니다.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {visibleGroups.map((g) => {
                const tags = new Set<RowStatus>();
                for (const r of g.rows) classifyGroupRow(r, g.rows).forEach((t) => tags.add(t));
                const rec = recommendAction(g.rows);
                const queued = pendingActions.get(g.key);
                return (
                  <li
                    key={g.key}
                    className={cn(
                      "border rounded-md p-2 cursor-pointer hover:bg-accent",
                      selectedGroupKey === g.key && "border-primary ring-1 ring-primary/30 bg-accent/50",
                    )}
                    onClick={() => setSelectedGroupKey(g.key)}
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={checkedKeys.has(g.key)}
                        onCheckedChange={(v) => {
                          setCheckedKeys((prev) => {
                            const m = new Set(prev);
                            if (v) m.add(g.key); else m.delete(g.key);
                            return m;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="tabular-nums">{g.date}</span>
                          <span className="truncate">{g.customer}</span>
                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">{g.rows.length}건</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {g.region || "-"} · {g.item}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {[...tags].filter((t) => t !== "normal").map((t) => (
                            <span key={t} className={cn("text-[10px] px-1.5 py-0.5 rounded border", STATUS_COLOR[t])}>
                              {statusLabel[t]}
                            </span>
                          ))}
                          {tags.size === 1 && tags.has("normal") && (
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", STATUS_COLOR.normal)}>
                              정상
                            </span>
                          )}
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border ml-auto", RECOMMEND_COLOR[rec])}>
                            추천: {actionLabel[rec]}
                          </span>
                        </div>
                        {queued && (
                          <div className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 inline-block">
                            예약: {actionLabel[queued.action]}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* 우측: 선택 그룹 비교 */}
        <Card className="p-3 md:p-4">
          {!selectedGroup ? (
            <div className="p-10 text-center text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
              왼쪽에서 그룹을 선택하면 같은 묶음 기록들을 나란히 비교할 수 있습니다.
            </div>
          ) : (
            <ComparePanel
              group={selectedGroup}
              leaders={leaders}
              queued={pendingActions.get(selectedGroup.key)}
              onQueue={(action, extra) => queueAction(selectedGroup, action, extra)}
              onClearAction={() => clearAction(selectedGroup.key)}
              onEditRow={(row) => setEditForm({ ...row })}
              onJumpToRecords={(id) => navigate(`/records?edit=${id}`)}
              onDedupe={() => dedupeGroup(selectedGroup)}
            />
          )}
        </Card>
      </div>

      {/* 일괄 적용 다이얼로그 */}
      <Dialog open={!!bulkOpen} onOpenChange={(o) => !o && setBulkOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              일괄 적용 — {bulkOpen ? actionLabel[bulkOpen] : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>대상 그룹 {checkedGroupCount}개에 일괄 적용합니다.</div>
            {bulkOpen === "merge_companion" && (
              <div className="space-y-1">
                <Label className="text-xs">동행 사유</Label>
                <Input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="예: 엘리베이터 고장" />
              </div>
            )}
            {bulkOpen === "merge_two_person" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">팀장2 (비어있는 행만 채움)</Label>
                  <LeaderCombobox leaders={leaders} value={bulkLeader2} onChange={setBulkLeader2} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">분할 방식</Label>
                  <select
                    value={bulkSplit}
                    onChange={(e) => setBulkSplit(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-2"
                  >
                    <option value="">(변경 없음)</option>
                    <option value="반반">반반</option>
                    <option value="2인배송">2인배송</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(null)}>취소</Button>
            <Button onClick={applyBulk}>예약</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 최종 검토 다이얼로그 */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>저장 전 최종 검토</DialogTitle>
          </DialogHeader>
          <ReviewBody
            plan={[...pendingActions.values()]}
            groupsByKey={groupsByKey}
            issues={validateIssues}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>다시 검토</Button>
            <Button
              onClick={applyAllChanges}
              disabled={saving || validateIssues.some((i) => i.severity === "error")}
            >
              {saving ? "적용 중…" : "수정 적용"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 직접 수정 다이얼로그 */}
      <Dialog open={!!editForm} onOpenChange={(o) => !o && setEditForm(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>직접 수정 — {editForm?.customer_name} ({editForm?.id?.slice(0, 8)})</DialogTitle>
          </DialogHeader>
          {editForm && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="팀장1">
                <LeaderCombobox
                  leaders={leaders}
                  value={editForm.leader1_id ?? ""}
                  onChange={(id) => setEditForm({ ...editForm, leader1_id: id || null })}
                />
              </Field>
              <Field label="팀장2">
                <LeaderCombobox
                  leaders={leaders}
                  value={editForm.leader2_id ?? ""}
                  onChange={(id) => setEditForm({ ...editForm, leader2_id: id || null })}
                />
              </Field>
              <Field label="2인배송">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={!!editForm.two_person}
                    onCheckedChange={(v) => setEditForm({ ...editForm, two_person: !!v })}
                  />
                  <span className="text-xs">예</span>
                </label>
              </Field>
              <Field label="동행">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={!!editForm.companion}
                    onCheckedChange={(v) => setEditForm({ ...editForm, companion: !!v })}
                  />
                  <span className="text-xs">예</span>
                </label>
              </Field>
              <Field label="동행 사유" full>
                <Input
                  value={editForm.companion_reason ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, companion_reason: e.target.value })}
                />
              </Field>
              <Field label="분할 방식">
                <select
                  value={editForm.split_type ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, split_type: e.target.value || null })}
                  className="h-9 w-full rounded-md border bg-background px-2"
                >
                  <option value="">(없음)</option>
                  <option value="반반">반반</option>
                  <option value="2인배송">2인배송</option>
                </select>
              </Field>
              <Field label="결제">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={!!editForm.paid}
                    onCheckedChange={(v) => setEditForm({ ...editForm, paid: !!v })}
                  />
                  <span className="text-xs">완료</span>
                </label>
              </Field>
              <Field label="수도권배송비">
                <Input
                  type="number"
                  value={String(editForm.metro_fee ?? 0)}
                  onChange={(e) => setEditForm({ ...editForm, metro_fee: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="지방배송비">
                <Input
                  type="number"
                  value={String(editForm.regional_fee ?? 0)}
                  onChange={(e) => setEditForm({ ...editForm, regional_fee: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="비고금액">
                <Input
                  type="number"
                  value={String(editForm.note_amount ?? 0)}
                  onChange={(e) => setEditForm({ ...editForm, note_amount: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="착불">
                <Input
                  type="number"
                  value={String(editForm.cod_amount ?? 0)}
                  onChange={(e) => setEditForm({ ...editForm, cod_amount: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditForm(null)}>취소</Button>
            <Button onClick={saveEdit} disabled={saving}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1", full && "col-span-2")}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ComparePanel({
  group, leaders, queued, onQueue, onClearAction, onEditRow, onJumpToRecords, onDedupe,
}: {
  group: LooseGroup;
  leaders: Leader[];
  queued?: MergePlanItem;
  onQueue: (action: RecommendedAction, extra?: Partial<MergePlanItem>) => void;
  onClearAction: () => void;
  onEditRow: (row: GroupRow) => void;
  onJumpToRecords: (id: string) => void;
  onDedupe: () => void;
}) {
  const rec = recommendAction(group.rows);
  // 동행 통합 사유 / 2인 통합용 팀장2 입력
  const [reason, setReason] = useState(queued?.companionReason ?? "");
  const [leader2, setLeader2] = useState(queued?.leader2Id ?? "");
  useEffect(() => {
    setReason(queued?.companionReason ?? "");
    setLeader2(queued?.leader2Id ?? "");
  }, [queued?.groupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields: { key: keyof GroupRow | "fee"; label: string; render: (r: GroupRow) => React.ReactNode; }[] = [
    { key: "date", label: "날짜", render: (r) => String(r.date ?? "").slice(0, 10) },
    { key: "customer_name", label: "고객명", render: (r) => r.customer_name },
    { key: "region", label: "배송지", render: (r) => r.region || "-" },
    { key: "item", label: "품목", render: (r) => r.item },
    { key: "leader1_name", label: "팀장1", render: (r) => r.leader1_name || "-" },
    { key: "leader2_name", label: "팀장2", render: (r) => r.leader2_name || "-" },
    { key: "two_person", label: "2인배송", render: (r) => (r.two_person ? "예" : "-") },
    { key: "companion", label: "동행", render: (r) => (r.companion ? "예" : "-") },
    { key: "split_type", label: "분할", render: (r) => r.split_type || "-" },
    { key: "metro_fee", label: "수도권", render: (r) => fmt(Number(r.metro_fee || 0)) },
    { key: "regional_fee", label: "지방", render: (r) => fmt(Number(r.regional_fee || 0)) },
    { key: "note_amount", label: "비고금액", render: (r) => fmt(Number(r.note_amount || 0)) },
    { key: "cod_amount", label: "착불", render: (r) => fmt(Number(r.cod_amount || 0)) },
    { key: "fee", label: "총액", render: (r) => fmt(totalFee(r)) },
  ];

  // 행 간 값이 다른 셀 강조
  const diffMap = new Map<string, boolean>();
  for (const f of fields) {
    const vals = group.rows.map((r) =>
      f.key === "fee" ? totalFee(r) : (r as any)[f.key],
    );
    const uniq = new Set(vals.map((v) => String(v ?? "")));
    if (uniq.size > 1) diffMap.set(String(f.key), true);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold">{group.date} · {group.customer} · {group.region || "-"} · {group.item}</div>
          <div className="text-xs text-muted-foreground">{group.rows.length}건 비교 — 추천: <span className="font-medium">{actionLabel[rec]}</span></div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {queued && (
            <span className="text-xs px-2 py-1 rounded bg-primary/10 border border-primary/30 text-primary">
              예약됨: {actionLabel[queued.action]}
            </span>
          )}
          {queued && (
            <Button size="sm" variant="ghost" onClick={onClearAction}>취소</Button>
          )}
        </div>
      </div>

      <div className="border rounded-md overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-2 py-1">필드</th>
              {group.rows.map((r, i) => (
                <th key={r.id} className="text-left px-2 py-1">
                  <div className="flex items-center gap-1">
                    <span>행 {i + 1}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">[{String(r.id).slice(0, 6)}]</span>
                    <Button size="sm" variant="ghost" className="h-5 px-1 ml-auto" onClick={() => onEditRow(r)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => onJumpToRecords(r.id)}>
                      ↗
                    </Button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const diff = diffMap.get(String(f.key));
              return (
                <tr key={String(f.key)} className="border-t">
                  <td className="px-2 py-1 font-medium text-muted-foreground whitespace-nowrap">{f.label}</td>
                  {group.rows.map((r) => {
                    const val = f.render(r);
                    const isEmpty = val === "-" || val === "" || val == null;
                    const isLeader2 = f.key === "leader2_name" && isEmpty;
                    return (
                      <td
                        key={r.id + String(f.key)}
                        className={cn(
                          "px-2 py-1 tabular-nums",
                          diff && "bg-amber-50",
                          isLeader2 && "bg-red-50 text-red-700",
                        )}
                      >
                        {val}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t bg-muted/20">
              <td className="px-2 py-1 font-medium text-muted-foreground">상태</td>
              {group.rows.map((r) => {
                const tags = classifyGroupRow(r, group.rows);
                return (
                  <td key={r.id + "_status"} className="px-2 py-1 space-x-1">
                    {tags.map((t) => (
                      <span key={t} className={cn("inline-block text-[10px] px-1.5 py-0.5 rounded border mr-1", STATUS_COLOR[t])}>
                        {statusLabel[t]}
                      </span>
                    ))}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* 액션 영역 */}
      <div className="border rounded-md p-3 space-y-2 bg-muted/20">
        <div className="text-xs font-semibold">통합/유지 판단</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">동행 사유 (동행 통합 시)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 엘리베이터 고장" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">팀장2 (2인배송 통합 시, 비어있는 행만 채움)</Label>
            <LeaderCombobox leaders={leaders} value={leader2} onChange={setLeader2} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="default"
            size="sm"
            onClick={() => onQueue("merge_companion", { companionReason: reason })}
          >
            동행 통합 예약
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => onQueue("merge_two_person", { leader2Id: leader2 || undefined })}
          >
            2인배송 통합 예약
          </Button>
          <Button variant="outline" size="sm" onClick={() => onQueue("keep_separate")}>
            별도 유지
          </Button>
          <Button variant="outline" size="sm" onClick={onDedupe}>
            <Trash2 className="h-3 w-3 mr-1" /> 완전중복 삭제
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewBody({
  plan, groupsByKey, issues,
}: {
  plan: MergePlanItem[];
  groupsByKey: Map<string, GroupRow[]>;
  issues: ReturnType<typeof validateMergePlan>;
}) {
  const count = (a: RecommendedAction) => plan.filter((p) => p.action === a).length;
  const leader2Added = plan
    .filter((p) => p.action === "merge_two_person" && p.leader2Id)
    .reduce((s, p) => s + (groupsByKey.get(p.groupKey) ?? []).filter((r) => !r.leader2_id).length, 0);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="수정 그룹 수" value={plan.length} />
        <Stat label="동행 통합" value={count("merge_companion")} />
        <Stat label="2인배송 통합" value={count("merge_two_person")} />
        <Stat label="별도 유지" value={count("keep_separate")} />
        <Stat label="팀장2 추가" value={leader2Added} />
      </div>
      {issues.length > 0 && (
        <div className="border rounded-md p-2 space-y-1 bg-amber-50">
          <div className="text-xs font-semibold flex items-center gap-1 text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" /> 충돌/오류 {issues.length}건
          </div>
          <ul className="text-xs space-y-0.5">
            {issues.map((i, idx) => (
              <li key={idx} className={i.severity === "error" ? "text-red-700" : "text-amber-700"}>
                · [{i.severity === "error" ? "차단" : "경고"}] {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        적용은 기존 행 update로 처리되며, insert는 발생하지 않습니다.
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-bold tabular-nums">{value}</div>
    </div>
  );
}