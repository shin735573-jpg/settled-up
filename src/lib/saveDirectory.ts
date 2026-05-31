// File System Access API 기반 저장 폴더 핸들 관리
// - 사용자가 바탕화면의 "삼호정산서" 폴더를 1회 지정하면 IndexedDB 에 핸들을 보관
// - 저장 시 핸들 안에 "YYYY-MM-DD_정산서/업체|팀장/" 폴더를 자동 생성

const DB_NAME = "samho-save";
const STORE = "handles";
const KEY = "rootDir";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isFsAccessSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === "function";
}

/** 사용자가 폴더(권장: 바탕화면/삼호정산서)를 직접 선택 */
export async function pickSaveDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFsAccessSupported()) {
    throw new Error("이 브라우저는 폴더 직접 저장을 지원하지 않습니다. (Chrome/Edge 권장)");
  }
  const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
    id: "samho-save-root",
    mode: "readwrite",
    startIn: "desktop",
  });
  await idbSet(KEY, handle);
  return handle;
}

export async function getSavedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await idbGet<FileSystemDirectoryHandle>(KEY);
    return h ?? null;
  } catch {
    return null;
  }
}

export async function clearSavedDirectoryHandle(): Promise<void> {
  await idbDel(KEY);
}

/** 저장 직전 권한 확인/재요청 */
export async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: "readwrite" } as any;
  // @ts-expect-error - non-standard but widely available
  const cur = await handle.queryPermission?.(opts);
  if (cur === "granted") return true;
  // @ts-expect-error - non-standard but widely available
  const req = await handle.requestPermission?.(opts);
  return req === "granted";
}

function todayFolderName(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}_정산서`;
}

/** 루트핸들 안에 "오늘날짜_정산서/업체"와 "/팀장" 폴더를 보장 */
export async function ensureTodayFolders(root: FileSystemDirectoryHandle): Promise<{
  rootName: string;
  todayDir: FileSystemDirectoryHandle;
  todayName: string;
  companyDir: FileSystemDirectoryHandle;
  leaderDir: FileSystemDirectoryHandle;
}> {
  const todayName = todayFolderName();
  const todayDir = await root.getDirectoryHandle(todayName, { create: true });
  const companyDir = await todayDir.getDirectoryHandle("업체", { create: true });
  const leaderDir = await todayDir.getDirectoryHandle("팀장", { create: true });
  return { rootName: root.name, todayDir, todayName, companyDir, leaderDir };
}

/** 디렉터리에 Blob 파일 쓰기 (덮어쓰기) */
export async function writeBlobToDir(dir: FileSystemDirectoryHandle, filename: string, blob: Blob): Promise<void> {
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}