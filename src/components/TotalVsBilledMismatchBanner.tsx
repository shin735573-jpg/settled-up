import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Download, ExternalLink } from "lucide-react";
import type { TotalVsBilledCheck } from "@/lib/totalVsBilledCrossCheck";

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

function buildCsv(result: TotalVsBilledCheck): string {
  const head = ["원인코드", "원인", "방향(T-B)", "금액", "행ID", "날짜", "업체", "고객", "품목", "행금액", "메모"];
  const rows: (string | number)[][] = [head];
  for (const c of result.components) {
    if (c.rows.length === 0) {
      rows.push([c.key, c.label, c.sign > 0 ? "+" : "-", c.amount, "", "", "", "", "", "", c.hint]);
      continue;
    }
    for (const r of c.rows) {
      rows.push([
        c.key, c.label, c.sign > 0 ? "+" : "-", c.amount,
        r.id ?? "", r.date ?? "", r.company_name ?? "", r.customer_name ?? "", r.item ?? "",
        r.fee, r.note ?? c.hint,
      ]);
    }
  }
  return toCsv(rows);
}

/**
 * "총배송비(정산용)" vs "업체청구금액(실제)" 차이의 100% 원인 분해 배너.
 * 두 값이 다른 이유를 항목별(결제·착불·VAT·정산제외·재방문 중복·미매칭)로 분해해 보여준다.
 */
export function TotalVsBilledMismatchBanner({ result }: { result: TotalVsBilledCheck }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [preVat, setPreVat] = useState(false);
  const navigate = useNavigate();

  const hasComponents = result.components.some((c) => c.amount > 0);
  if (!hasComponents && result.diff === 0) return null;

  // preVat 모드: 부가세(vat_added)를 제거한 B (= B − VAT) 와 T 비교
  const vatComp = result.components.find((c) => c.key === "vat_added");
  const vatAmt = vatComp?.amount ?? 0;
  const billedDisplay = preVat ? result.billedTotal - vatAmt : result.billedTotal;
  const diffDisplay = result.totalFee - billedDisplay;
  const componentsDisplay = preVat
    ? result.components.filter((c) => c.key !== "vat_added")
    : result.components;
  const reconstructedDisplay = componentsDisplay.reduce((s, c) => s + c.signedAmount, 0);
  const reconcileOk = Math.abs(reconstructedDisplay - diffDisplay) <= 1;

  return (
    <div className="rounded border border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <strong className="text-amber-700 dark:text-amber-400">
            총배송비 vs {preVat ? "업체청구(VAT제외)" : "업체청구금액"} 차이 100% 추적
          </strong>
          <span className="ml-2">
            총배송비 {result.totalFee.toLocaleString()}원 − {preVat ? "B−VAT" : "업체청구"} {billedDisplay.toLocaleString()}원
            {" = "}
            <span className={diffDisplay !== 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>
              {diffDisplay > 0 ? "+" : ""}{diffDisplay.toLocaleString()}원
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span
            onClick={(e) => { e.stopPropagation(); setPreVat((v) => !v); }}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs cursor-pointer ${preVat ? "border-amber-500 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold" : "border-border bg-background text-muted-foreground hover:bg-muted/50"}`}
            title="부가세(VAT) 가산 항목을 제외하고 T vs B−VAT 비교"
          >
            preVat {preVat ? "ON" : "OFF"}
          </span>
          <span
            onClick={(e) => { e.stopPropagation(); downloadCsv(buildCsv(result), "total-vs-billed.csv"); }}
            className="inline-flex items-center gap-1 rounded border border-amber-500 bg-background px-2 py-1 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {preVat && (
            <div className="text-xs text-muted-foreground">
              preVat 모드: 부가세 가산({vatAmt.toLocaleString()}원, {vatComp?.rows.length ?? 0}건)을 제외한 업체청구(B−VAT)와 총배송비(T)를 비교합니다.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-1 py-1 font-medium">원인</th>
                  <th className="text-right px-1 py-1 font-medium">금액</th>
                  <th className="text-right px-1 py-1 font-medium">T−B 기여</th>
                  <th className="text-right px-1 py-1 font-medium">영향 행수</th>
                  <th className="text-left px-1 py-1 font-medium">메모</th>
                </tr>
              </thead>
              <tbody>
                {componentsDisplay.map((c) => {
                  const hot = c.amount > 0;
                  return (
                    <tr key={c.key} className="border-b border-border/40">
                      <td className="px-1 py-1">{c.label}</td>
                      <td className="px-1 py-1 text-right tabular-nums">{c.amount.toLocaleString()}</td>
                      <td className={`px-1 py-1 text-right tabular-nums ${hot ? "font-semibold" : "text-muted-foreground"}`}>
                        {c.sign > 0 ? "+" : "−"}{c.amount.toLocaleString()}
                      </td>
                      <td className="px-1 py-1 text-right tabular-nums text-muted-foreground">{c.rows.length}</td>
                      <td className="px-1 py-1 text-muted-foreground">{c.hint}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-amber-500 font-semibold">
                  <td className="px-1 py-1">분해 합 (T−B 재구성)</td>
                  <td className="px-1 py-1" />
                  <td className={`px-1 py-1 text-right tabular-nums ${reconcileOk ? "" : "text-destructive"}`}>
                    {reconstructedDisplay > 0 ? "+" : ""}{reconstructedDisplay.toLocaleString()}
                  </td>
                  <td className="px-1 py-1 text-right tabular-nums" colSpan={2}>
                    {reconcileOk
                      ? "✓ 실제 차이와 일치 (100% 추적됨)"
                      : `⚠ 실제 차이 ${diffDisplay.toLocaleString()}원과 ${(diffDisplay - reconstructedDisplay).toLocaleString()}원 불일치`}
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
            {componentsDisplay.filter((c) => c.amount > 0).map((c) => (
              <ComponentBlock key={c.key} label={c.label} hint={c.hint} rows={c.rows} query={query} onJump={(id) => navigate(`/records?edit=${id}`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComponentBlock({
  label, hint, rows, query, onJump,
}: {
  label: string;
  hint: string;
  rows: { id?: string | null; date?: string | null; company_name?: string | null; customer_name?: string | null; item?: string | null; fee: number; note?: string }[];
  query: string;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.date, r.company_name, r.customer_name, r.item, r.note, String(r.fee), r.fee.toLocaleString()].filter(Boolean).join(" ").toLowerCase();
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
          {filtered.slice(0, 30).map((r, i) => (
            <li
              key={r.id ?? i}
              className={`flex items-center justify-between gap-2 px-2 py-1 text-xs ${r.id ? "cursor-pointer hover:bg-muted/50" : ""}`}
              onClick={() => r.id && onJump(r.id)}
            >
              <span className="truncate">
                {r.date ?? "-"} · {r.company_name ?? "-"} · {r.customer_name ?? "-"} · {r.item ?? "-"}
                {r.note && <span className="ml-1 text-muted-foreground">[{r.note}]</span>}
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className="tabular-nums">{r.fee.toLocaleString()}원</span>
                {r.id && <ExternalLink className="h-3 w-3" />}
              </span>
            </li>
          ))}
          {filtered.length > 30 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">…외 {filtered.length - 30}건</li>
          )}
        </ul>
      )}
    </div>
  );
}