// 정산서 저장/재생성 시 합계 검증 결과 이력 (localStorage)
// 같은 (month, period) 안에서 v1, v2, v3 ... 로 단조 증가.
// 매 저장 사이클마다 1개 엔트리 추가: 저장 직후 다시 실행한 검증 결과(errors/warnings) 스냅샷.
// 이전 버전과의 차이(해소/신규)를 자동 계산해 함께 보관한다.

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
  /** 같은 (month, period) 안에서 v1, v2, v3 ... 단조 증가. */
  version: number;
  /** ISO timestamp */
  at: string;
  scope: AuditScope;
  title: string;
  regenerate: boolean;
  /** 저장 직후 재검증으로 얻은 스냅샷. */
  errors: string[];
  warnings: string[];
  /** 직전 버전 대비 해소된/신규 항목. v1 이면 모두 빈 배열. */
  resolvedWarnings: string[];
  newWarnings: string[];
  resolvedErrors: string[];
  newErrors: string[];
};

type Index = Record<string, AuditEntry[]>;

function load(): Index {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Index; }
  catch { return {}; }
}
function save(idx: Index) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(idx)); }
  catch {
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

function diff(prev: string[], curr: string[]): { resolved: string[]; added: string[] } {
  const p = new Set(prev);
  const c = new Set(curr);
  return {
    resolved: [...p].filter((x) => !c.has(x)),
    added: [...c].filter((x) => !p.has(x)),
  };
}

export type AppendAuditInput = {
  month: string;
  period: string;
  scope: AuditScope;
  title: string;
  regenerate: boolean;
  errors: string[];
  warnings: string[];
};

/** 저장 직후 재검증 결과 1건을 기록. 직전 v(N-1) 과의 차이를 자동 계산. */
export function appendValidationAudit(input: AppendAuditInput): AuditEntry {
  const idx = load();
  const k = keyFor(input.month, input.period);
  const list = idx[k] ?? [];
  const prev = list[list.length - 1];
  const version = prev ? prev.version + 1 : 1;
  const w = prev ? diff(prev.warnings, input.warnings) : { resolved: [], added: [] };
  const e = prev ? diff(prev.errors, input.errors) : { resolved: [], added: [] };
  const entry: AuditEntry = {
    version,
    at: new Date().toISOString(),
    scope: input.scope,
    title: input.title,
    regenerate: input.regenerate,
    errors: input.errors,
    warnings: input.warnings,
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
  return `경고 ${e.warnings.length} · 오류 ${e.errors.length} (직전 대비 해소 ${e.resolvedWarnings.length + e.resolvedErrors.length}, 신규 ${e.newWarnings.length + e.newErrors.length})`;
}
