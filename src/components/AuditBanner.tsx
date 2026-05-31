import { useState } from "react";
import type { AuditResult, AuditFinding } from "@/lib/liveAudit";
import { AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronRight } from "lucide-react";

/**
 * 자동검증 결과 배너.
 * - 오류 1개 이상: 빨강
 * - 경고만: 노랑
 * - 정보만: 파랑
 * - 비어 있으면: (compact) 작은 OK 표시 또는 null
 */
export function AuditBanner({
  title = "자동검증",
  result,
  defaultOpen = false,
  hideWhenClean = false,
}: {
  title?: string;
  result: AuditResult;
  defaultOpen?: boolean;
  hideWhenClean?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const total = result.findings.length;

  if (total === 0) {
    if (hideWhenClean) return null;
    return (
      <div className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        <span><strong>{title}</strong> 통과 — 계산서 미발행 · 거부업체 숨김 · 내부/제출 분리 모두 정상</span>
      </div>
    );
  }

  const hasError = result.errors.length > 0;
  const hasWarn = result.warnings.length > 0;
  const tone = hasError
    ? "border-destructive bg-destructive/10 text-destructive"
    : hasWarn
    ? "border-amber-400 bg-amber-50 text-amber-900"
    : "border-sky-400 bg-sky-50 text-sky-900";
  const Icon = hasError ? AlertTriangle : hasWarn ? AlertTriangle : Info;

  return (
    <div className={`rounded border px-3 py-2 text-sm ${tone}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Icon className="h-4 w-4" />
        <span className="font-semibold">{title}</span>
        <span className="ml-2 text-xs opacity-80">
          오류 {result.errors.length} · 경고 {result.warnings.length} · 안내 {result.infos.length}
        </span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 pl-6">
          {result.findings.map((f, i) => (
            <li key={i} className="leading-snug">
              <SeverityTag s={f.severity} /> {f.message}
              {f.detail && (
                <div className="text-xs opacity-80 mt-0.5 break-words">{f.detail}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeverityTag({ s }: { s: AuditFinding["severity"] }) {
  const map = {
    error: ["오류", "bg-destructive/20 text-destructive"],
    warning: ["경고", "bg-amber-200/60 text-amber-900"],
    info: ["안내", "bg-sky-200/60 text-sky-900"],
  } as const;
  const [label, cls] = map[s];
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold mr-1 ${cls}`}>
      {label}
    </span>
  );
}