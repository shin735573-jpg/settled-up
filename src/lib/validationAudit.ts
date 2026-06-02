// 정산서 저장/재생성 시 합계 검증 결과 이력 (localStorage)
// 같은 (month, period) 안에서 v1, v2, v3 ... 로 단조 증가하며 before/after 경고를 기록.
// 단일 저장 / 전체 저장 / 재생성 / 자동저장 모두 1회 호출에 1개 엔트리.

const STORAGE_KEY = "validation_audit_v1";
const MAX_ENTRIES_PER_KEY = 30;

export type AuditScope =
  | "company-one"
  | "company-all"
  | "leader-one"
  | "leader-all"
  | "both-all"
  | "auto";

export type AuditEntry = {
  version: number;
  at: string;
  scope: AuditScope;
  title: string;
  regenerate: boolean;
  errorsBefore: string[];
  warningsBefore: string[];
  errorsAfter: string[];
  warningsAfter: string[];
  resolvedWarnings: string[];
  newWarnings: string[];
  resolvedErrors: string[];
  newErrors: string[];
};

type Index = Record<string, AuditEntry[]>;

function load(): Index {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Index;
  } catch {
    return {};
  }
}

function save(idx: Index) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(idx));
  } catch {
    const entries = Object.entries(idx);
    if (entries.length > 4) {
      const kept: Index = {};
      for (const [k, v] of entries.slice(-Math.max(2, Math.floor(entries.length / 2)))) kept[k] = v;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(kept)); } catch { /* give up */ }
    }
  }
}

function keyFor(month: string, period: string) {
  return `${month}:${period}`;
}

function nextVersion(list: AuditEntry[] | undefined): number {
  if (!list || list.length === 0) return 1;
  return Math.max(...list.map((e) => e.version)) + 1;
}

function diff(before: string[], after: string[]): { resolved: string[]; added: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  const resolved = [...b].filter((x) => !a.has(x));
  const added = [...a].filter((x) => !b.has(x));
  return { resolved, added };
}

export type AppendAuditInput = {
  month: string;
  period: string;
  scope: AuditScope;
  title: string;
  regenerate: boolean;
  before: { errors: string[]; warnings: string[] };
  after: { errors: string[]; warnings: string[] };
};

export function appendValidationAudit(input: AppendAuditInput): AuditEntry {
  const idx = load();
  const k = keyFor(input.month, input.period);
  const list = idx[k] ?? [];
  const w = diff(input.before.warnings, input.after.warnings);
  const e = diff(input.before.errors, input.after.errors);
  const entry: AuditEntry = {
    version: nextVersion(list),
    at: new Date().toISOString(),
    scope: input.scope,
    title: input.title,
    regenerate: input.regenerate,
    errorsBefore: input.before.errors,
    warningsBefore: input.before.warnings,
    errorsAfter: input.after.errors,
    warningsAfter: input.after.warnings,
    resolvedWarnings: w.resolved,
    newWarnings: w.added,
    resolvedErrors: e.resolved,
    newErrors: e.added,
  };
  const trimmed = [...list, entry].slice(-MAX_ENTRIES_PER_KEY);
  idx[k] = trimmed;
  save(idx);
  return entry;
}

export function getValidationAudits(month: string, period: string): AuditEntry[] {
  return load()[keyFor(month, period)] ?? [];
}

export function clearValidationAudits(month: string, period: string) {
  const idx = load();
  delete idx[keyFor(month, period)];
  save(idx);
}

export function summarizeAudit(e: AuditEntry): string {
  const wB = e.warningsBefore.length;
  const wA = e.warningsAfter.length;
  const eB = e.errorsBefore.length;
  const eA = e.errorsAfter.length;
  return `경고 ${wB} → ${wA} (해소 ${e.resolvedWarnings.length} / 신규 ${e.newWarnings.length}) · 오류 ${eB} → ${eA}`;
}
