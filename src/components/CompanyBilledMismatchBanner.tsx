import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { CompanyBilledCrossCheck, CompanyBilledDiff } from "@/lib/companyBilledCrossCheck";

/**
 * 팀장정산 "업체청구금액(실제)" vs 업체정산서 청구금액 100% 일치 추적 배너.
 * 업체별로 어떤 규칙 때문에 차이가 났는지, 그리고 어떤 행이 영향을 줬는지를 보여준다.
 */
export function CompanyBilledMismatchBanner({ result }: { result: CompanyBilledCrossCheck }) {
  const [openCo, setOpenCo] = useState<Record<string, boolean>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  if (result.ok) return null;

  return (
    <div className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <strong>업체청구금액 불일치 추적 — </strong>
      팀장정산 합계 {result.leaderTotal.toLocaleString()}원 vs 업체정산서 합계 {result.companyTotal.toLocaleString()}원
      (차이 {result.diff.toLocaleString()}원). 업체를 펼치면 차이 원인과 영향 행을 확인할 수 있습니다.

      <div className="mt-2 flex flex-col gap-1 text-xs">
        {result.perCompany.map((co) => (
          <CompanyBlock
            key={co.companyId}
            co={co}
            isOpen={!!openCo[co.companyId]}
            onToggle={() =>
              setOpenCo((p) => ({ ...p, [co.companyId]: !p[co.companyId] }))
            }
            query={queries[co.companyId] ?? ""}
            onQuery={(v) => setQueries((p) => ({ ...p, [co.companyId]: v }))}
            onRowJump={(id) => navigate(`/records?edit=${id}`)}
          />
        ))}
      </div>
    </div>
  );
}

function CompanyBlock({
  co, isOpen, onToggle, query, onQuery, onRowJump,
}: {
  co: CompanyBilledDiff;
  isOpen: boolean;
  onToggle: () => void;
  query: string;
  onQuery: (v: string) => void;
  onRowJump: (id: string) => void;
}) {
  return (
    <div className="rounded border border-destructive/30">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:opacity-80"
      >
        <span className="flex items-center gap-1">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="font-medium">{co.companyName}</span>
          <span className="text-muted-foreground">
            팀장정산 {co.leaderSide.toLocaleString()}원 / 업체정산서 {co.companySide.toLocaleString()}원
          </span>
        </span>
        <span className={co.diff !== 0 ? "font-semibold" : "text-muted-foreground"}>
          차이 {co.diff > 0 ? "+" : ""}{co.diff.toLocaleString()}원
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-destructive/20 bg-background/40 px-2 py-1 text-foreground">
          <div className="mb-2 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-1 py-1 font-medium">항목</th>
                  <th className="text-right px-1 py-1 font-medium">팀장정산식</th>
                  <th className="text-right px-1 py-1 font-medium">업체정산서식</th>
                  <th className="text-right px-1 py-1 font-medium">차이</th>
                  <th className="text-left px-1 py-1 font-medium">메모</th>
                </tr>
              </thead>
              <tbody>
                {co.components.map((c) => {
                  const isFinal = c.key === "final";
                  const hot = c.diff !== 0;
                  return (
                    <tr
                      key={c.key}
                      className={`border-b border-border/40 ${isFinal ? "font-semibold" : ""}`}
                    >
                      <td className="px-1 py-1">{c.label}</td>
                      <td className="px-1 py-1 text-right tabular-nums">{c.leader.toLocaleString()}</td>
                      <td className="px-1 py-1 text-right tabular-nums">{c.company.toLocaleString()}</td>
                      <td
                        className={`px-1 py-1 text-right tabular-nums ${
                          hot ? "text-destructive font-semibold" : "text-muted-foreground"
                        }`}
                      >
                        {c.diff > 0 ? "+" : ""}{c.diff.toLocaleString()}
                      </td>
                      <td className="px-1 py-1 text-muted-foreground">{c.hint ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="날짜/품목/팀장/금액 검색"
            className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {co.reasons.length === 0 ? (
            <div className="py-1 text-muted-foreground">원인 미탐지 (반올림 또는 알 수 없는 차이)</div>
          ) : (
            <ul className="space-y-2">
              {co.reasons.map((r, idx) => {
                const q = query.trim().toLowerCase();
                const filtered = q
                  ? r.rows.filter((row) => {
                      const hay = [
                        row.date, row.company_name, row.customer_name,
                        row.item, row.leader1_name, row.note_label,
                        String(row.fee ?? ""), row.fee?.toLocaleString?.() ?? "",
                      ].filter(Boolean).join(" ").toLowerCase();
                      return hay.includes(q);
                    })
                  : r.rows;
                return (
                  <li key={idx} className="rounded border border-destructive/20 p-1">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <span className="font-medium">[{r.code}] {r.label}</span>
                      <span className="text-muted-foreground">영향 ≈ {r.amount.toLocaleString()}원 · {r.rows.length}행</span>
                    </div>
                    {filtered.length > 0 && (
                      <ul className="mt-1 divide-y divide-border">
                        {filtered.slice(0, 20).map((row, i) => (
                          <li
                            key={row.id ?? i}
                            className={`flex items-center justify-between gap-2 px-1 py-1 ${
                              row.id ? "cursor-pointer hover:bg-muted/50" : ""
                            }`}
                            onClick={() => row.id && onRowJump(row.id)}
                          >
                            <span className="truncate">
                              {row.date ?? "-"} · {row.item ?? "-"} · {row.leader1_name ?? "-"}
                              {row.note_label && (
                                <span className="ml-1 text-muted-foreground">[{row.note_label}]</span>
                              )}
                            </span>
                            <span className="flex items-center gap-2 whitespace-nowrap">
                              <span className="tabular-nums">{row.fee.toLocaleString()}원</span>
                              {row.id && <ExternalLink className="h-3 w-3" />}
                            </span>
                          </li>
                        ))}
                        {filtered.length > 20 && (
                          <li className="px-1 py-1 text-muted-foreground">
                            …외 {filtered.length - 20}건
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}