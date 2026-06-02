import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

type GroupRow = {
  id: string;
  date: string;
  revisit_visit_no: number;
  metro_fee: number;
  note_amount: number;
  regional_fee: number;
  cod_amount: number;
  leader1_name: string | null;
  leader2_name: string | null;
  leader3_name: string | null;
  customer_name: string | null;
  region: string | null;
  company_name: string;
};

type EditableRow = GroupRow & { dirty?: boolean };

/**
 * 재방문 그룹 전체 차수(1차, 2차, …)를 한 화면에서 함께 보고 금액을 수정하는 패널.
 * - 현재 편집 중인 행의 그룹 ID로 모든 차수를 불러옴
 * - 금액(시내/노트/지방/착불)만 인라인 편집 가능
 * - "그룹 일괄 수정" 버튼으로 변경된 행만 UPDATE
 */
export function RevisitGroupPanel({
  groupId,
  currentRowId,
  onSaved,
}: {
  groupId: string;
  currentRowId?: string | null;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("deliveries")
      .select(
        "id,date,revisit_visit_no,metro_fee,note_amount,regional_fee,cod_amount,leader1_name,leader2_name,leader3_name,customer_name,region,company_name"
      )
      .eq("revisit_group_id", groupId)
      .order("revisit_visit_no", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error(`그룹 조회 실패: ${error.message}`);
      return;
    }
    setRows(((data || []) as GroupRow[]).map((r) => ({ ...r })));
  };

  useEffect(() => {
    if (groupId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const setAmount = (id: string, key: keyof GroupRow, val: string) => {
    const n = Number(val.replace(/[^\d.-]/g, "")) || 0;
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [key]: n, dirty: true } : r))
    );
  };

  const saveAll = async () => {
    const dirty = rows.filter((r) => r.dirty);
    if (dirty.length === 0) {
      toast.info("변경된 행이 없습니다");
      return;
    }
    setSaving(true);
    for (const r of dirty) {
      const { error } = await supabase
        .from("deliveries")
        .update({
          metro_fee: r.metro_fee,
          note_amount: r.note_amount,
          regional_fee: r.regional_fee,
          cod_amount: r.cod_amount,
        })
        .eq("id", r.id);
      if (error) {
        setSaving(false);
        toast.error(`${r.revisit_visit_no}차 저장 실패: ${error.message}`);
        return;
      }
    }
    setSaving(false);
    toast.success(`${dirty.length}개 차수 수정 완료`);
    await load();
    onSaved?.();
  };

  if (!groupId) return null;
  if (loading && rows.length === 0) {
    return (
      <Card className="p-3 text-sm text-muted-foreground">
        재방문 그룹 불러오는 중…
      </Card>
    );
  }
  if (rows.length === 0) return null;

  return (
    <Card className="p-3 space-y-2 border-dashed">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          재방문 그룹 ({rows.length}개 차수) — 금액을 함께 수정할 수 있습니다
        </div>
        <Button size="sm" onClick={saveAll} disabled={saving}>
          {saving ? "저장 중…" : "그룹 일괄 수정"}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left py-1 pr-2">차수</th>
              <th className="text-left py-1 pr-2">날짜</th>
              <th className="text-left py-1 pr-2">팀장</th>
              <th className="text-right py-1 pr-2">시내</th>
              <th className="text-right py-1 pr-2">노트</th>
              <th className="text-right py-1 pr-2">지방</th>
              <th className="text-right py-1 pr-2">착불</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isCurrent = currentRowId && r.id === currentRowId;
              const leaders = [r.leader1_name, r.leader2_name, r.leader3_name]
                .filter(Boolean)
                .join(", ");
              return (
                <tr
                  key={r.id}
                  className={isCurrent ? "bg-accent/40" : undefined}
                >
                  <td className="py-1 pr-2 font-medium">
                    {r.revisit_visit_no}차{isCurrent ? " (현재)" : ""}
                  </td>
                  <td className="py-1 pr-2">{r.date}</td>
                  <td className="py-1 pr-2 truncate max-w-[140px]">
                    {leaders || "-"}
                  </td>
                  <td className="py-1 pr-1">
                    <Input
                      className="h-7 text-right text-xs"
                      value={String(r.metro_fee || 0)}
                      onChange={(e) =>
                        setAmount(r.id, "metro_fee", e.target.value)
                      }
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <Input
                      className="h-7 text-right text-xs"
                      value={String(r.note_amount || 0)}
                      onChange={(e) =>
                        setAmount(r.id, "note_amount", e.target.value)
                      }
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <Input
                      className="h-7 text-right text-xs"
                      value={String(r.regional_fee || 0)}
                      onChange={(e) =>
                        setAmount(r.id, "regional_fee", e.target.value)
                      }
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <Input
                      className="h-7 text-right text-xs"
                      value={String(r.cod_amount || 0)}
                      onChange={(e) =>
                        setAmount(r.id, "cod_amount", e.target.value)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}