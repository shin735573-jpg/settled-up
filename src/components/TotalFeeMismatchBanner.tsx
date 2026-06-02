import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLink } from "lucide-react";
import type { TotalCrossCheck, CategoryBreakdown } from "@/lib/totalFeeCrossCheck";

/**
 * 업체정산 ↔ 팀장정산 총배송비 불일치 경고 배너.
 * 항목 클릭 → 해당 카테고리에 속한 실제 행 목록을 다이얼로그로 표시.
 */
export function TotalFeeMismatchBanner({
  result,
  unifiedLabel = "통합식",
  leaderLabel = "팀장정산식",
}: {
  result: TotalCrossCheck;
  unifiedLabel?: string;
  leaderLabel?: string;
}) {
  const [active, setActive] = useState<CategoryBreakdown | null>(null);
  const navigate = useNavigate();
  if (result.ok) return null;

  return (
    <>
      <div className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <strong>총배송비 검증 실패 — </strong>
        {unifiedLabel} {result.unified.toLocaleString()}원 vs {leaderLabel} {result.leaderStyle.toLocaleString()}원
        (차이 {result.diff.toLocaleString()}원). 항목을 클릭하면 차이를 만든 실제 행 목록을 볼 수 있습니다.
        <div className="mt-2 grid gap-1 text-xs">
          {result.categories.map((c) => {
            const clickable = c.count > 0;
            return (
              <button
                key={c.label}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setActive(c)}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-left ${
                  clickable
                    ? "hover:bg-destructive/20 cursor-pointer"
                    : "opacity-60 cursor-default"
                }`}
              >
                <span>
                  {c.label} — {c.count}건 / {c.amount.toLocaleString()}원
                  <span className="ml-1 text-muted-foreground">
                    ({unifiedLabel}: {c.includedInUnified ? "포함" : "제외"} · {leaderLabel}: {c.includedInLeaderStyle ? "포함" : "제외"})
                  </span>
                </span>
                <span className={c.contribution !== 0 ? "font-semibold" : "text-muted-foreground"}>
                  차이 영향 {c.contribution > 0 ? "+" : ""}{c.contribution.toLocaleString()}원
                  {clickable && <span className="ml-2 underline">자세히</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{active?.label}</DialogTitle>
            <DialogDescription>
              총 {active?.count.toLocaleString()}건 · 합계 {active?.amount.toLocaleString()}원
              {active && active.contribution !== 0 && (
                <> · 차이 영향 <strong>{active.contribution > 0 ? "+" : ""}{active.contribution.toLocaleString()}원</strong></>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">편집</TableHead>
                  <TableHead>날짜</TableHead>
                  <TableHead>업체</TableHead>
                  <TableHead>고객</TableHead>
                  <TableHead>품목</TableHead>
                  <TableHead>팀장1</TableHead>
                  <TableHead className="text-right">배송비</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active?.rows.map((r, i) => (
                  <TableRow
                    key={r.id ?? i}
                    className={r.id ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => {
                      if (!r.id) return;
                      setActive(null);
                      navigate(`/records?edit=${r.id}`);
                    }}
                  >
                    <TableCell>
                      {r.id ? (
                        <span className="inline-flex items-center gap-1 text-primary underline">
                          <ExternalLink className="h-3.5 w-3.5" /> 열기
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">id 없음</span>
                      )}
                    </TableCell>
                    <TableCell>{r.date ?? "-"}</TableCell>
                    <TableCell>{r.company_name ?? "-"}</TableCell>
                    <TableCell>{r.customer_name ?? "-"}</TableCell>
                    <TableCell>{r.item ?? "-"}</TableCell>
                    <TableCell>{r.leader1_name ?? "-"}</TableCell>
                    <TableCell className="text-right">{r.fee.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {!active?.rows.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">행 없음</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            행을 클릭하면 기록입력(/records) 화면이 해당 행을 자동으로 편집 모드로 열어줍니다.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}