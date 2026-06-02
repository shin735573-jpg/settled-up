import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { fmt } from "@/lib/format";
import type { SummaryMismatchTrace } from "@/lib/summaryMismatchTrace";

const csvEscape = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: (string | number)[][]): string =>
  rows.map((r) => r.map(csvEscape).join(",")).join("\n");
function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildCsv(trace: SummaryMismatchTrace): string {
  const head = ["원인코드", "원인", "방향(L-C)", "기여금액", "행ID", "날짜", "업체", "고객", "품목", "메모"];
  const rows: (string | number)[][] = [head];
  for (const c of trace.components) {
    if (c.rows.length === 0) {
      rows.push([c.key, c.label, c.sign > 0 ? "+" : "-", c.amount, "", "", "", "", "", c.hint]);
      continue;
    }
    for (const r of c.rows) {
      rows.push([
        c.key, c.label, c.sign > 0 ? "+" : "-", r.amount,
        r.id ?? "", r.date ?? "", r.company_name ?? "", r.customer_name ?? "", r.item ?? "",
        r.note ?? c.hint,
      ]);
    }
  }
  return toCsv(rows);
}

/**
 * Summary 페이지의 "업체 총금액" vs "팀장 배송비 합" 차이를 100% 추적해 보여주는 패널.
 * 차이가 0이면 표시하지 않는다.
 */
export function SummaryMismatchPanel({ trace }: { trace: SummaryMismatchTrace }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");

  if (trace.ok && trace.components.every((c) => c.amount === 0)) return null;

  const reconcileOk = Math.abs(trace.reconstructed - trace.diff) <= 1;

  return (
    <div className="rounded border border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1 flex-wrap">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <strong className="text-amber-700 dark:text-amber-400">
            업체 총금액 vs 팀장 배송비 합 차이 100% 추적
          </strong>
          <span className="ml-2">
            팀장 {fmt(trace.leaderTotal)} − 업체 {fmt(trace.companyTotal)} ={" "}
            <span className={trace.diff !== 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>
              {trace.diff > 0 ? "+" : ""}{fmt(trace.diff)}
            </span>
          </span>
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); downloadCsv(buildCsv(trace), "summary-mismatch.csv"); }}
          className="inline-flex items-center gap-1 rounded border border-amber-500 bg-background px-2 py-1 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-1 py-1 font-medium">원인</th>
                  <th className="text-right px-1 py-1 font-medium">금액</th>
                  <th className="text-right px-1 py-1 font-medium">L−C 기여</th>
                  <th className="text-right px-1 py-1 font-medium">영향 행수</th>
                  <th className="text-left px-1 py-1 font-medium">메모</th>
                </tr>
              </thead>
              <tbody>
                {trace.components.map((c) => {
                  const hot = c.amount > 0;
                  return (
                    <tr key={c.key} className="border-b border-border/40">
                      <td className="px-1 py-1">{c.label}</td>
                      <td className="px-1 py-1 text-right tabular-nums">{fmt(c.amount)}</td>
                      <td className={`px-1 py-1 text-right tabular-nums ${hot ? "font-semibold" : "text-muted-foreground"}`}>
                        {c.sign > 0 ? "+" : "−"}{fmt(c.amount)}
                      </td>
                      <td className="px-1 py-1 text-right tabular-nums text-muted-foreground">{c.rows.length}</td>
                      <td className="px-1 py-1 text-muted-foreground">{c.hint}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-amber-500 font-semibold">
                  <td className="px-1 py-1">분해 합 (L−C 재구성)</td>
                  <td className="px-1 py-1" />
                  <td className={`px-1 py-1 text-right tabular-nums ${reconcileOk ? "" : "text-destructive"}`}>
                    {trace.reconstructed > 0 ? "+" : ""}{fmt(trace.reconstructed)}
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums" colSpan={2}>
                    {reconcileOk
                      ? "✓ 실제 차이와 일치 (100% 추적됨)"
                      : `⚠ 실제 차이 ${fmt(trace.diff)} 와 ${fmt(trace.diff - trace.reconstructed)} 불일치`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="원인 행 검색 (날짜/업체/고객/품목/메모)"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />

          <div className="grid gap-2">
            {trace.components.filter((c) => c.amount > 0).map((c) => (
              <ComponentBlock key={c.key} label={c.label} hint={c.hint} rows={c.rows} query={query} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComponentBlock({
  label, hint, rows, query,
}: {
  label: string;
  hint: string;
  rows: { id?: string | null; date?: string | null; company_name?: string | null; customer_name?: string | null; item?: string | null; amount: number; note?: string }[];
  query: string;
}) {
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.date, r.company_name, r.customer_name, r.item, r.note, String(r.amount), fmt(r.amount)].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  return (
    <div className="rounded border border-amber-500/40 bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs hover:opacity-80"
      >
        <span className="flex items-center gap-1">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">{rows.length}행</span>
        </span>
        <span className="text-muted-foreground">{hint}</span>
      </button>
      {open && filtered.length > 0 && (
        <ul className="divide-y divide-border border-t border-border/60">
          {filtered.slice(0, 50).map((r, i) => (
            <li key={r.id ?? i} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
              <span className="truncate">
                {r.date ?? "-"} · {r.company_name ?? "-"} · {r.customer_name ?? "-"} · {r.item ?? "-"}
                {r.note && <span className="ml-1 text-muted-foreground">[{r.note}]</span>}
              </span>
              <span className="tabular-nums whitespace-nowrap">{fmt(r.amount)}</span>
            </li>
          ))}
          {filtered.length > 50 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">…외 {filtered.length - 50}건</li>
          )}
        </ul>
      )}
    </div>
  );
}