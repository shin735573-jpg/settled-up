// 정산서 파일 버전 관리 (localStorage) — 재생성시 v+1, v1 보존
// key 예: "company:<companyId>:2026-05:h1", "leader:<leaderId>:2026-05:h1"

const STORAGE_KEY = "statement_versions_v1";

export type VersionStatus = "생성완료" | "재생성완료";
export type VersionEntry = {
  key: string;
  version: number;
  status: VersionStatus;
  createdAt: string;
};

type Index = Record<string, VersionEntry>;

function load(): Index {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Index; }
  catch { return {}; }
}
function save(idx: Index) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(idx));
}

export function keyFor(kind: "company" | "leader", id: string, month: string, period: string) {
  return `${kind}:${id}:${month}:${period}`;
}

export function getEntry(key: string): VersionEntry | null {
  return load()[key] ?? null;
}

/** 새 저장 — 기존 없으면 v1, 있으면 v+1 (재생성으로 간주) */
export function bumpVersion(key: string, regenerate: boolean): VersionEntry {
  const idx = load();
  const prev = idx[key];
  const version = prev ? prev.version + (regenerate ? 1 : 0) : 1;
  const entry: VersionEntry = {
    key,
    version: prev && !regenerate ? prev.version : version,
    status: prev ? "재생성완료" : "생성완료",
    createdAt: new Date().toISOString(),
  };
  idx[key] = entry;
  save(idx);
  return entry;
}