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

/**
 * 새 저장 — 기존 없으면 v1, 재생성 시 prev.version + 1.
 * 단조 증가 보장:
 *  - 저장 직전에 localStorage 를 다시 읽어 가장 최신 prev 사용 (다른 탭/이전 호출과의 충돌 방지)
 *  - 절대 prev.version 보다 작은 버전이 기록되지 않음 (Math.max)
 *  - 일반 저장(regenerate=false) 은 기존 버전을 유지 (덮어쓰기)
 *  - 재생성(regenerate=true) 은 항상 +1 (이미 vN 이면 v(N+1))
 */
export function bumpVersion(key: string, regenerate: boolean): VersionEntry {
  // read-modify-write: 직전에 한 번 더 읽어 최신 상태 기준으로 결정
  const idx = load();
  const prev = idx[key];
  const prevVersion = prev?.version ?? 0;
  const nextVersion = prev
    ? (regenerate ? prevVersion + 1 : prevVersion)
    : 1;
  // 단조 증가 가드 — 어떤 경우에도 prev 보다 작아질 수 없음
  const safeVersion = Math.max(prevVersion, nextVersion, 1);
  const entry: VersionEntry = {
    key,
    version: safeVersion,
    status: prev ? "재생성완료" : "생성완료",
    createdAt: new Date().toISOString(),
  };
  // write-back 직전 한 번 더 최신 인덱스를 읽어 다른 키들의 동시 갱신 손실 방지
  const latest = load();
  latest[key] = entry;
  save(latest);
  return entry;
}