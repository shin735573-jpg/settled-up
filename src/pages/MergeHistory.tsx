import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { revertMergeLog } from "@/lib/mergeLog";

type Snapshot = {
  id: string;
  date?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  region?: string | null;
  item?: string | null;
  note?: string | null;
  leader1_name?: string | null;
  leader2_name?: string | null;
  two_person?: boolean | null;
  companion?: boolean | null;
  metro_fee?: number | null;
  regional_fee?: number | null;
  note_amount?: number | null;
  cod_amount?: number | null;
  split_type?: string | null;
  [k: string]: unknown;
};

type MergeLogRow = {
  id: string;
  base_row_id: string;
  merge_action: string;
  merged_at: string;
  reverted_at: string | null;
  base_before: Snapshot;
  base_after: Snapshot;
  merged_rows: Snapshot[];
};

function fmt(v: unknown) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  return String(v);
}
function feeTotal(r: Snapshot) {
  return (Number(r?.metro_fee) || 0) + (Number(r?.note_amount) || 0) + (Number(r?.regional_fee) || 0);
}

const COMPARE_FIELDS: Array<{ k: keyof Snapshot | "total"; label: string }> = [
  { k: "date", label: "날짜" },
  { k: "company_name", label: "업체" },
  { k: "customer_name", label: "고객명" },
  { k: "region", label: "배송지" },
  { k: "item", label: "품목" },
  { k: "note", label: "비고" },
  { k: "leader1_name", label: "팀장1" },
  { k: "leader2_name", label: "팀장2" },
  { k: "companion", label: "동행" },
  { k: "two_person", label: "2인배송" },
  { k: "split_type", label: "분할" },
  { k: "metro_fee", label: "수도권비" },
  { k: "regional_fee", label: "지방비" },
  { k: "note_amount", label: "비고금액" },
  { k: "cod_amount", label: "착불" },
  { k: "total", label: "총 청구금액" },
];

export default function MergeHistory() {
  const [rows, setRows] = useState<MergeLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMonth, setFilterMonth] = useState<string>("");
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [filterAction, setFilterAction] = useState<"all" | "merge_companion" | "merge_two_person">("all");
  const [detail, setDetail] = useState<MergeLogRow | null>(null);
  const [reverting, setReverting] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState<MergeLogRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("delivery_merge_log")
      .select("*")
      .order("merged_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) {
      toast.error("통합 이력 조회 실패: " + error.message);
      return;
    }
    setRows((data ?? []) as unknown as MergeLogRow[]);
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (showOnlyActive && r.reverted_at) return false;
      if (filterAction !== "all" && r.merge_action !== filterAction) return false;
      if (filterMonth) {
        const d = String(r.base_after?.date || r.base_before?.date || "").slice(0, 7);
        if (d !== filterMonth) return false;
      }
      if (q) {
        const hay = [
          r.base_after?.company_name,
          r.base_after?.customer_name,
          r.base_after?.region,
          r.base_after?.item,
          r.base_after?.note,
          r.base_after?.leader1_name,
          r.base_after?.leader2_name,
          ...(r.merged_rows ?? []).flatMap((m) => [m?.company_name, m?.customer_name, m?.leader1_name, m?.leader2_name]),
        ]
          .map((x) => String(x ?? "").toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, filterMonth, showOnlyActive, filterAction]);

  const doRevert = async (log: MergeLogRow) => {
    setReverting(true);
    const { error } = await revertMergeLog(log.id);
    setReverting(false);
    if (error) {
      toast.error("통합 해제 실패: " + (error as Error).message);
      return;
    }
    toast.success(`통합 해제 완료 · 원본 ${(log.merged_rows ?? []).length + 1}건 복구됨`);
    setConfirmRevert(null);
    setDetail(null);
    await load();
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 md:p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 flex-1 min-w-[220px]">
            <Label className="text-xs">검색 (업체/고객/배송지/품목/팀장/비고)</Label>
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
            <Label className="text-xs">월</Label>
            <Input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="w-40 h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">통합 방식</Label>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value as typeof filterAction)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">전체</option>
              <option value="merge_companion">동행 통합</option>
              <option value="merge_two_person">2인배송 통합</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm h-9 px-2">
            <input
              type="checkbox"
              checked={showOnlyActive}
              onChange={(e) => setShowOnlyActive(e.target.checked)}
            />
            미해제만 보기
          </label>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "새로고침"}
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">통합일시</TableHead>
              <TableHead className="w-[110px]">방식</TableHead>
              <TableHead>날짜</TableHead>
              <TableHead>업체</TableHead>
              <TableHead>고객명</TableHead>
              <TableHead>배송지</TableHead>
              <TableHead>품목</TableHead>
              <TableHead>팀장1</TableHead>
              <TableHead>팀장2</TableHead>
              <TableHead className="text-right">청구금액</TableHead>
              <TableHead className="text-center">합쳐진</TableHead>
              <TableHead className="w-[100px]">상태</TableHead>
              <TableHead className="w-[160px] text-right">동작</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-8">
                  통합 이력이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => {
              const a = r.base_after || {};
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">
                    {new Date(r.merged_at).toLocaleString("ko-KR", { hour12: false })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.merge_action === "merge_two_person" ? "default" : "secondary"}>
                      {r.merge_action === "merge_two_person" ? "2인배송" : "동행"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{fmt(a.date)}</TableCell>
                  <TableCell className="text-xs">{fmt(a.company_name)}</TableCell>
                  <TableCell className="text-xs">{fmt(a.customer_name)}</TableCell>
                  <TableCell className="text-xs">{fmt(a.region)}</TableCell>
                  <TableCell className="text-xs">{fmt(a.item)}</TableCell>
                  <TableCell className="text-xs">{fmt(a.leader1_name)}</TableCell>
                  <TableCell className="text-xs">{fmt(a.leader2_name)}</TableCell>
                  <TableCell className="text-xs text-right">{fmt(feeTotal(a))}</TableCell>
                  <TableCell className="text-xs text-center">{(r.merged_rows ?? []).length}건</TableCell>
                  <TableCell>
                    {r.reverted_at ? (
                      <Badge variant="outline">해제됨</Badge>
                    ) : (
                      <Badge variant="destructive">통합됨</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                        비교
                      </Button>
                      {!r.reverted_at && (
                        <Button size="sm" variant="outline" onClick={() => setConfirmRevert(r)}>
                          <RotateCcw className="h-3 w-3 mr-1" /> 해제
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* 통합 전/후 비교 모달 */}
      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>통합 전/후 비교</DialogTitle>
            <DialogDescription>
              {detail && new Date(detail.merged_at).toLocaleString("ko-KR")} ·
              {" "}{detail?.merge_action === "merge_two_person" ? "2인배송 통합" : "동행 통합"}
              {detail?.reverted_at && " (해제됨)"}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">항목</TableHead>
                    <TableHead className="bg-muted/40">기준 (통합 전)</TableHead>
                    {(detail.merged_rows ?? []).map((m, i) => (
                      <TableHead key={m.id || i} className="bg-muted/40">
                        합쳐진 #{i + 1}
                      </TableHead>
                    ))}
                    <TableHead className="bg-primary/10 font-semibold">통합 후 (최종)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMPARE_FIELDS.map(({ k, label }) => {
                    const before = k === "total" ? feeTotal(detail.base_before) : (detail.base_before as Snapshot)[k];
                    const after = k === "total" ? feeTotal(detail.base_after) : (detail.base_after as Snapshot)[k];
                    return (
                      <TableRow key={k as string}>
                        <TableCell className="text-xs font-medium">{label}</TableCell>
                        <TableCell className="text-xs">{fmt(before)}</TableCell>
                        {(detail.merged_rows ?? []).map((m, i) => {
                          const v = k === "total" ? feeTotal(m) : m[k];
                          return (
                            <TableCell key={(m.id || i) + String(k)} className="text-xs">
                              {fmt(v)}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-xs bg-primary/5 font-medium">
                          {fmt(after)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            {detail && !detail.reverted_at && (
              <Button variant="outline" onClick={() => setConfirmRevert(detail)}>
                <RotateCcw className="h-4 w-4 mr-1" /> 통합 해제
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDetail(null)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 해제 확인 모달 */}
      <Dialog open={!!confirmRevert} onOpenChange={(v) => { if (!v) setConfirmRevert(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>통합 해제 확인</DialogTitle>
            <DialogDescription>
              기준 행을 통합 전 값으로 되돌리고, 합쳐졌던
              {" "}{(confirmRevert?.merged_rows ?? []).length}건을 다시 복구합니다.
              <br />원본 그대로 복원되므로 이후 다시 통합하거나 수정할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRevert(null)} disabled={reverting}>
              취소
            </Button>
            <Button
              onClick={() => confirmRevert && doRevert(confirmRevert)}
              disabled={reverting}
            >
              {reverting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
              통합 해제 실행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}