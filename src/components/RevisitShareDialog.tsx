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
import { LeaderCombobox, type ComboLeader } from "@/components/LeaderCombobox";
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
    if (first.revisit_manual_shares && first.revisit_manual_shares.length > 0) {
      setRows(
        first.revisit_manual_shares.map((s) => ({
          leader_id: s.leader_id,
          leader_name: s.leader_name || "",
          amount: Number(s.amount) || 0,
        })),
      );
      return;
    }
    // 프리필: 그룹 등장 팀장 + 1차 팀장1 전액
    const seen = new Set<string>();
    const prefill: RevisitShare[] = [];
    const candidates = [
      { id: first.leader1_id, name: first.leader1_name },
      { id: first.leader2_id, name: first.leader2_name },
      { id: first.leader3_id, name: first.leader3_name },
      ...extraLeaders,
    ];
    candidates.forEach((c) => {
      if (!c.id || seen.has(c.id)) return;
      seen.add(c.id);
      prefill.push({ leader_id: c.id, leader_name: c.name || "", amount: 0 });
    });
    if (prefill.length > 0) prefill[0].amount = baseTotal;
    setRows(prefill);
  }, [open, first?.id]);

  const sumEntered = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows],
  );
  const diff = baseTotal - sumEntered;

  if (!first) return null;

  const updateRow = (idx: number, patch: Partial<RevisitShare>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((rs) => [...rs, { leader_id: "", leader_name: "", amount: 0 }]);
  const removeRow = (idx: number) =>
    setRows((rs) => rs.filter((_, i) => i !== idx));

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
            1차 배송비를 팀장별로 직접 분배합니다. 입력하지 않은 경우 1차 행의 팀장1에게 전액 귀속됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
            <div>1차 날짜: <b>{first.date}</b></div>
            <div>고객/지역: <b>{first.customer_name || "-"}</b> / {first.region || "-"}</div>
            <div>1차 총액: <b>{baseTotal.toLocaleString()}원</b>
              <span className="ml-2 text-xs">
                (수도권 {Number(first.metro_fee).toLocaleString()} / 비고 {Number(first.note_amount).toLocaleString()} / 지방 {Number(first.regional_fee).toLocaleString()})
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <LeaderCombobox
                    leaders={leaders}
                    value={r.leader_id}
                    onChange={(id) => {
                      const lead = leaders.find((l) => l.id === id);
                      updateRow(i, { leader_id: id, leader_name: lead?.name || "" });
                    }}
                    placeholder="팀장 선택"
                    allowEmpty={false}
                  />
                </div>
                <Input
                  type="number"
                  className="w-36 text-right"
                  value={r.amount || ""}
                  onChange={(e) => updateRow(i, { amount: Number(e.target.value) || 0 })}
                  placeholder="금액"
                />
                <span className="text-sm text-muted-foreground">원</span>
                <Button size="sm" variant="ghost" onClick={() => removeRow(i)}>삭제</Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addRow}>+ 팀장 추가</Button>
          </div>
          <div className="flex items-center justify-end gap-4 text-sm border-t pt-2">
            <span>입력 합계: <b>{sumEntered.toLocaleString()}원</b></span>
            <span className={diff === 0 ? "text-muted-foreground" : "text-destructive"}>
              차액: {diff.toLocaleString()}원
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
          <Button onClick={save} disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}