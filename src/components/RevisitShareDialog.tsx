import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ComboLeader } from "@/components/LeaderCombobox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type RevisitShare = {
  leader_id: string;
  leader_name: string;
  amount: number;
};

export type RevisitFirstRow = {
  id: string;
  date: string;
  customer_name: string | null;
  region: string | null;
  metro_fee: number;
  note_amount: number;
  regional_fee: number;
  leader1_id: string | null;
  leader1_name: string | null;
  leader2_id: string | null;
  leader2_name: string | null;
  leader3_id: string | null;
  leader3_name: string | null;
  revisit_group_id: string | null;
  revisit_manual_shares: RevisitShare[] | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  first: RevisitFirstRow | null;
  /** 그룹 내 모든 행(1차+후속)의 팀장들 — 자동 프리필용 */
  extraLeaders?: Array<{ id: string | null; name: string | null }>;
  leaders: ComboLeader[];
  onSaved?: () => void;
}

/**
 * 재방문 그룹의 팀장 분배를 수기로 입력하는 다이얼로그.
 * - 청구액 베이스는 1차 행의 metro+note+regional 합계.
 * - 분배는 팀장별 금액으로 입력(자동 합계/차액 표시).
 * - 저장 시 1차 행에 revisit_manual_shares / revisit_distributed=true 저장,
 *   같은 그룹의 모든 행 revisit_done=true.
 */
export function RevisitShareDialog({
  open,
  onOpenChange,
  first,
  extraLeaders = [],
  leaders,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<RevisitShare[]>([]);
  const [saving, setSaving] = useState(false);

  const baseTotal = first
    ? Number(first.metro_fee) + Number(first.note_amount) + Number(first.regional_fee)
    : 0;

  useEffect(() => {
    if (!open || !first) return;
    // 1차 + 2차(이후) 팀장만 분배 대상 — 팀장 추가/삭제/변경 불가, 금액만 수정.
    const allLeaders: Array<{ id: string | null; name: string | null; visit: 1 | 2 }> = [
      { id: first.leader1_id, name: first.leader1_name, visit: 1 },
      { id: first.leader2_id, name: first.leader2_name, visit: 1 },
      { id: first.leader3_id, name: first.leader3_name, visit: 1 },
      ...extraLeaders.map((l) => ({ ...l, visit: 2 as const })),
    ];
    const seen = new Set<string>();
    const base: Array<RevisitShare & { visit?: 1 | 2 }> = [];
    allLeaders.forEach((c) => {
      if (!c.id || seen.has(c.id)) return;
      seen.add(c.id);
      base.push({ leader_id: c.id, leader_name: c.name || "", amount: 0, visit: c.visit });
    });
    // 저장된 수기분배가 있으면 해당 팀장 금액 복원
    if (first.revisit_manual_shares && first.revisit_manual_shares.length > 0) {
      const savedMap = new Map(
        first.revisit_manual_shares.map((s) => [s.leader_id, Number(s.amount) || 0]),
      );
      base.forEach((r) => {
        if (savedMap.has(r.leader_id)) r.amount = savedMap.get(r.leader_id) || 0;
      });
    } else if (base.length > 0) {
      base[0].amount = baseTotal;
    }
    setRows(base);
  }, [open, first?.id]);

  const sumEntered = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows],
  );
  const remaining = baseTotal - sumEntered;
  const overBudget = sumEntered > baseTotal;
  const exactMatch = sumEntered === baseTotal;

  if (!first) return null;

  const updateRow = (idx: number, patch: Partial<RevisitShare>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const distributeEqually = () => {
    const valid = rows.filter((r) => r.leader_id);
    if (valid.length === 0) {
      toast.error("팀장을 먼저 선택해주세요");
      return;
    }
    const per = Math.floor(baseTotal / valid.length);
    const leftover = baseTotal - per * valid.length;
    let assigned = 0;
    setRows((rs) =>
      rs.map((r) => {
        if (!r.leader_id) return { ...r, amount: 0 };
        assigned += 1;
        return { ...r, amount: assigned === valid.length ? per + leftover : per };
      }),
    );
  };

  const assignRemainingTo = (idx: number) => {
    setRows((rs) =>
      rs.map((r, i) =>
        i === idx ? { ...r, amount: Math.max(0, (Number(r.amount) || 0) + remaining) } : r,
      ),
    );
  };

  const save = async () => {
    const cleaned = rows
      .filter((r) => r.leader_id && Number(r.amount) > 0)
      .map((r) => {
        const lead = leaders.find((l) => l.id === r.leader_id);
        return {
          leader_id: r.leader_id,
          leader_name: lead?.name || r.leader_name || "",
          amount: Math.round(Number(r.amount)),
        };
      });
    const total = cleaned.reduce((s, r) => s + r.amount, 0);
    if (baseTotal > 0 && total !== baseTotal) {
      toast.error(`팀장 분배 합계(${total.toLocaleString()}원)가 1차 청구금액(${baseTotal.toLocaleString()}원)과 일치해야 저장할 수 있습니다`);
      return;
    }
    setSaving(true);
    try {
      // 1차 행에 수기분배 저장
      const { error: e1 } = await supabase
        .from("deliveries")
        .update({
          revisit_manual_shares: cleaned.length > 0 ? cleaned : null,
          revisit_distributed: cleaned.length > 0,
          revisit_done: true,
        })
        .eq("id", first.id);
      if (e1) throw e1;
      // 같은 그룹의 모든 행 revisit_done=true
      if (first.revisit_group_id) {
        await supabase
          .from("deliveries")
          .update({ revisit_done: true })
          .eq("revisit_group_id", first.revisit_group_id);
      }
      toast.success("재방문 분배가 저장되었습니다");
      onSaved?.();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`저장 실패: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>재방문 팀장 분배 입력</DialogTitle>
          <DialogDescription>
            아래 1차 고정금액 범위 안에서 팀장별 정산 금액을 직접 입력합니다.
            합계가 고정금액과 정확히 일치해야 저장됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-primary/5 p-4">
            <div className="text-xs text-muted-foreground">1차 고정금액 (분배 한도)</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">
              {baseTotal.toLocaleString()}<span className="text-base font-medium ml-1">원</span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {first.date} · {first.customer_name || "-"} / {first.region || "-"}
              <span className="ml-2">
                (수도권 {Number(first.metro_fee).toLocaleString()} / 비고 {Number(first.note_amount).toLocaleString()} / 지방 {Number(first.regional_fee).toLocaleString()})
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">팀장별 분배</div>
            <Button size="sm" variant="outline" onClick={distributeEqually}>
              균등 분배
            </Button>
          </div>
          <div className="space-y-2">
            {rows.length === 0 && (
              <div className="text-sm text-muted-foreground">
                1차 배송에 팀장이 지정되어 있지 않습니다.
              </div>
            )}
            {rows.map((r, i) => (
              <div key={r.leader_id || i} className="flex items-center gap-2">
                <div className="flex-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {r.leader_name || "(이름 없음)"}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {(r as RevisitShare & { visit?: 1 | 2 }).visit === 2 ? "2차 팀장" : "1차 팀장"}
                  </span>
                </div>
                <Input
                  type="number"
                  className="w-36 text-right"
                  value={r.amount || ""}
                  onChange={(e) => updateRow(i, { amount: Number(e.target.value) || 0 })}
                  placeholder="금액"
                />
                <span className="text-sm text-muted-foreground">원</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => assignRemainingTo(i)}
                  disabled={remaining === 0}
                  title="남은 금액을 이 팀장에게 배정"
                >
                  잔액
                </Button>
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              ※ 1차 청구금액은 수정 불가. 1차·2차 팀장의 금액 합계가 청구금액과 정확히 일치해야 저장됩니다.
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm border-t pt-3">
            <div className="rounded-md border p-2 text-center">
              <div className="text-xs text-muted-foreground">고정금액</div>
              <div className="font-semibold tabular-nums">{baseTotal.toLocaleString()}원</div>
            </div>
            <div className="rounded-md border p-2 text-center">
              <div className="text-xs text-muted-foreground">입력 합계</div>
              <div className={`font-semibold tabular-nums ${overBudget ? "text-destructive" : ""}`}>
                {sumEntered.toLocaleString()}원
              </div>
            </div>
            <div className={`rounded-md border p-2 text-center ${exactMatch ? "bg-primary/10 border-primary/30" : overBudget ? "bg-destructive/10 border-destructive/30" : ""}`}>
              <div className="text-xs text-muted-foreground">
                {overBudget ? "초과" : "남은 금액"}
              </div>
              <div className={`font-semibold tabular-nums ${overBudget ? "text-destructive" : exactMatch ? "text-primary" : ""}`}>
                {Math.abs(remaining).toLocaleString()}원
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
          <Button onClick={save} disabled={saving || (sumEntered > 0 && !exactMatch)}>
            {saving ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}