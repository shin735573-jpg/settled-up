import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

type Row = {
  id: string;
  occurred_at: string;
  context_label: string;
  conflict_count: number;
  current_snapshot: any;
  conflict_snapshot: any;
  diff_fields: string[];
  conflict_row_id: string | null;
  conflict_user_id: string | null;
  conflict_created_at: string | null;
  conflict_updated_at: string | null;
};

const fmtDt = (s?: string | null) => {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return s; }
};

export default function SaveConflicts() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("save_conflicts")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(500);
    if (error) { toast.error(`로그 불러오기 실패: ${error.message}`); setLoading(false); return; }
    const list = (data || []) as Row[];
    setRows(list);
    const uids = Array.from(new Set(list.map((r) => r.conflict_user_id).filter(Boolean) as string[]));
    if (uids.length) {
      const { data: profs } = await supabase
        .from("profiles").select("user_id,display_name").in("user_id", uids);
      setNameMap(new Map((profs || []).map((p: any) => [p.user_id, p.display_name || ""])));
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const toggle = (id: string) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const whoLabel = (uid: string | null) => {
    if (!uid) return "-";
    const nm = nameMap.get(uid) || "(이름 없음)";
    return uid === user?.id ? `${nm} (본인 — 다른 기기/세션)` : nm;
  };

  const clearAll = async () => {
    if (!user) return;
    if (!confirm("저장 충돌 로그를 모두 삭제할까요?")) return;
    const { error } = await supabase.from("save_conflicts").delete().eq("user_id", user.id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    toast.success("삭제 완료");
    load();
  };

  return (
    <div className="p-3 md:p-6 space-y-3 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          <h1 className="text-xl md:text-2xl font-bold">저장 충돌 로그</h1>
          <Badge variant="secondary">{rows.length}건</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1" /> 새로고침
          </Button>
          <Button size="sm" variant="destructive" onClick={clearAll} disabled={rows.length === 0}>
            전체 삭제
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        기록 저장 시 중복 차단(다른 기기에서 먼저 저장된 동일 기록 등)으로 저장이 막힌 사례가 시간순으로 기록됩니다.
        각 행을 펼치면 누가/언제 저장했는지와 현재 입력 vs 저장된 기록의 어떤 필드가 달랐는지 볼 수 있습니다.
      </p>
      {loading && <div className="text-sm text-muted-foreground">불러오는 중…</div>}
      {!loading && rows.length === 0 && (
        <Card className="p-6 text-center text-muted-foreground">기록된 저장 충돌이 없습니다.</Card>
      )}
      <div className="space-y-2">
        {rows.map((r) => {
          const isOpen = open.has(r.id);
          const cs = r.current_snapshot || {};
          const sv = r.conflict_snapshot || {};
          return (
            <Card key={r.id} className="overflow-hidden">
              <button
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40"
                onClick={() => toggle(r.id)}
              >
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Badge variant="outline" className="shrink-0">{fmtDt(r.occurred_at)}</Badge>
                <Badge className="shrink-0">{r.context_label}</Badge>
                <span className="text-sm truncate flex-1">
                  {cs.date || "-"} · {cs.company_name || "-"} · {cs.customer_name || "-"} · {cs.item || "-"}
                </span>
                <Badge variant="secondary" className="shrink-0">
                  완전 중복 {r.conflict_count}건
                </Badge>
                {r.diff_fields?.length > 0 && (
                  <Badge variant="destructive" className="shrink-0">
                    {r.diff_fields.length}개 필드 다름
                  </Badge>
                )}
              </button>
              {isOpen && (
                <div className="border-t px-3 py-3 text-sm space-y-3 bg-muted/20">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded border bg-background p-2">
                      <div className="font-semibold text-xs text-muted-foreground mb-1">먼저 저장된 기록</div>
                      <div>저장자: <b>{whoLabel(r.conflict_user_id)}</b></div>
                      <div>저장 시각: {fmtDt(r.conflict_created_at)}</div>
                      {r.conflict_updated_at && r.conflict_updated_at !== r.conflict_created_at && (
                        <div>마지막 수정: {fmtDt(r.conflict_updated_at)}</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">row id: {r.conflict_row_id || "-"}</div>
                    </div>
                    <div className="rounded border bg-background p-2">
                      <div className="font-semibold text-xs text-muted-foreground mb-1">상황</div>
                      <div>{r.context_label}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        차이 필드: {r.diff_fields?.length ? r.diff_fields.join(", ") : "없음 (완전 동일)"}
                      </div>
                    </div>
                  </div>
                  <div className="overflow-auto rounded border bg-background">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr>
                          <th className="px-2 py-1 text-left">항목</th>
                          <th className="px-2 py-1 text-left">현재 입력</th>
                          <th className="px-2 py-1 text-left">저장된 기록</th>
                          <th className="px-2 py-1 text-center">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["날짜", "date"], ["업체", "company_name"], ["고객", "customer_name"],
                          ["배송지", "region"], ["품목", "item"], ["비고", "note"],
                          ["팀장1", "leader1_name"], ["팀장2", "leader2_name"],
                          ["팀장3", "leader3_name"], ["가상기사", "virtual_leader_name"],
                          ["수도권 배송비", "metro_fee"], ["지방 배송비", "regional_fee"],
                          ["비고 금액", "note_amount"], ["착불 금액", "cod_amount"],
                          ["분할 방식", "split_type"], ["2인배송", "two_person"],
                        ].map(([label, key]) => {
                          const a = cs[key]; const b = sv[key];
                          const differs = String(a ?? "") !== String(b ?? "");
                          const cls = differs ? "text-destructive font-semibold" : "";
                          return (
                            <tr key={key} className="border-t">
                              <td className="px-2 py-1 text-muted-foreground">{label}</td>
                              <td className={"px-2 py-1 " + cls}>{String(a ?? "-")}</td>
                              <td className={"px-2 py-1 " + cls}>{String(b ?? "-")}</td>
                              <td className="px-2 py-1 text-center">
                                {differs
                                  ? <span className="text-destructive font-semibold">다름</span>
                                  : <span className="text-muted-foreground">일치</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}