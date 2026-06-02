// JPG 생성 + ZIP 묶음 다운로드 (카톡 공유 최적화)
import { toJpeg } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { bumpVersion, keyFor } from "./statementVersion";
import { supabase } from "@/integrations/supabase/client";
import { ensureTodayFolders, ensureWritePermission, writeBlobToDir } from "./saveDirectory";

/** 한 정산서가 여러 페이지로 분할될 때 각 페이지 노드 */
export type ExportTarget = {
  kind: "company" | "leader";
  id: string;
  name: string;
  /** 같은 정산서의 페이지들(긴 상세는 여러 장) */
  pages: HTMLElement[];
};

const SAFE = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim();

/** 기간키(h1/h2/all) → 한글 라벨 (파일/폴더명 용) */
export const periodLabelKR = (p: string) =>
  p === "h1" ? "1-15일" : p === "h2" ? "16-말일" : "월전체";

async function renderJpg(node: HTMLElement): Promise<Blob> {
  const dataUrl = await toJpeg(node, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    cacheBust: true,
    quality: 0.92,
  });
  const res = await fetch(dataUrl);
  return await res.blob();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** OneDrive 에지 함수로 단일 JPG 업로드 */
async function uploadOneDrive(folder: string, filename: string, blob: Blob) {
  const contentBase64 = await blobToBase64(blob);
  const { data, error } = await supabase.functions.invoke("onedrive-upload", {
    body: {
      action: "upload",
      folder,
      filename,
      contentBase64,
      contentType: "image/jpeg",
    },
  });
  if (error) throw new Error(`OneDrive 업로드 실패: ${error.message}`);
  if (data?.error) throw new Error(`OneDrive 업로드 실패: ${data.error}`);
  return data as { ok: true; webUrl?: string };
}

export type ExportOptions = {
  /** true면 OneDrive에도 업로드 (로컬 다운로드는 항상 수행) */
  uploadOneDrive?: boolean;
  /** 지정 시: 다운로드 대신 이 폴더 안에 "오늘날짜_정산서/업체|팀장/" 구조로 직접 저장 */
  saveDirectory?: FileSystemDirectoryHandle | null;
};

export async function exportSingle(
  target: ExportTarget,
  month: string,
  period: string,
  regenerate: boolean,
  options: ExportOptions = {},
): Promise<{ filename: string; version: number; pages: number }> {
  const entry = bumpVersion(keyFor(target.kind, target.id, month, period), regenerate);
  const kindLabel = target.kind === "company" ? "업체" : "팀장";
  const pLabel = periodLabelKR(period);
  const base = `${kindLabel}_${SAFE(target.name)}_${month}_${pLabel}_v${entry.version}`;
  const odFolder = `정산서_저장/${month}_${pLabel}/${kindLabel}`;

  // 지정 폴더가 있으면: 다운로드 없이 폴더 안에 JPG 들을 직접 저장 (오늘날짜_정산서/업체|팀장)
  if (options.saveDirectory) {
    const ok = await ensureWritePermission(options.saveDirectory);
    if (!ok) throw new Error("저장 폴더 쓰기 권한이 거부되었습니다. 폴더를 다시 지정하세요.");
    const dirs = await ensureTodayFolders(options.saveDirectory);
    const targetDir = target.kind === "company" ? dirs.companyDir : dirs.leaderDir;
    if (target.pages.length === 1) {
      const blob = await renderJpg(target.pages[0]);
      const filename = `${base}.jpg`;
      await writeBlobToDir(targetDir, filename, blob);
      if (options.uploadOneDrive) await uploadOneDrive(odFolder, filename, blob);
      return { filename: `${dirs.todayName}/${kindLabel}/${filename}`, version: entry.version, pages: 1 };
    }
    let i = 1;
    for (const node of target.pages) {
      const blob = await renderJpg(node);
      const jpgName = `${base}_${i}.jpg`;
      await writeBlobToDir(targetDir, jpgName, blob);
      if (options.uploadOneDrive) await uploadOneDrive(odFolder, jpgName, blob);
      i++;
    }
    return { filename: `${dirs.todayName}/${kindLabel}/${base}_*.jpg`, version: entry.version, pages: target.pages.length };
  }

  // 폴더 미지정 → 기존 동작 (다운로드)
  if (target.pages.length === 1) {
    const blob = await renderJpg(target.pages[0]);
    const filename = `${base}.jpg`;
    saveAs(blob, filename);
    if (options.uploadOneDrive) await uploadOneDrive(odFolder, filename, blob);
    return { filename, version: entry.version, pages: 1 };
  }
  const zip = new JSZip();
  let i = 1;
  for (const node of target.pages) {
    const blob = await renderJpg(node);
    const jpgName = `${base}_${i}.jpg`;
    zip.file(jpgName, blob);
    if (options.uploadOneDrive) await uploadOneDrive(odFolder, jpgName, blob);
    i++;
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const filename = `${base}.zip`;
  saveAs(zipBlob, filename);
  return { filename, version: entry.version, pages: target.pages.length };
}

export async function exportZip(
  targets: ExportTarget[],
  month: string,
  period: string,
  regenerate: boolean,
  onProgress?: (done: number, total: number, name: string) => void,
  options: ExportOptions = {},
): Promise<{ filename: string; count: number }> {
  // 지정 폴더가 있으면: ZIP 없이 폴더에 직접 저장
  if (options.saveDirectory) {
    const ok = await ensureWritePermission(options.saveDirectory);
    if (!ok) throw new Error("저장 폴더 쓰기 권한이 거부되었습니다. 폴더를 다시 지정하세요.");
    const dirs = await ensureTodayFolders(options.saveDirectory);
    const pLabel = periodLabelKR(period);
    let i = 0;
    for (const t of targets) {
      onProgress?.(i, targets.length, t.name);
      const entry = bumpVersion(keyFor(t.kind, t.id, month, period), regenerate);
      const kindLabel = t.kind === "company" ? "업체" : "팀장";
      const targetDir = t.kind === "company" ? dirs.companyDir : dirs.leaderDir;
      const odFolder = `정산서_저장/${month}_${pLabel}/${kindLabel}`;
      const base = `${kindLabel}_${SAFE(t.name)}_${month}_${pLabel}_v${entry.version}`;
      if (t.pages.length === 1) {
        const blob = await renderJpg(t.pages[0]);
        await writeBlobToDir(targetDir, `${base}.jpg`, blob);
        if (options.uploadOneDrive) await uploadOneDrive(odFolder, `${base}.jpg`, blob);
      } else {
        let p = 1;
        for (const node of t.pages) {
          const blob = await renderJpg(node);
          const jpgName = `${base}_${p}.jpg`;
          await writeBlobToDir(targetDir, jpgName, blob);
          if (options.uploadOneDrive) await uploadOneDrive(odFolder, jpgName, blob);
          p++;
        }
      }
      i++;
    }
    onProgress?.(targets.length, targets.length, "");
    return { filename: `${dirs.todayName}/`, count: targets.length };
  }

  const zip = new JSZip();
  const pLabel = periodLabelKR(period);
  // 폴더 구조: 정산서_저장/YYYY-MM_<기간>/업체|팀장/
  const root = zip.folder("정산서_저장")!.folder(`${month}_${pLabel}`)!;
  const companyFolder = root.folder("업체")!;
  const leaderFolder = root.folder("팀장")!;
  let i = 0;
  for (const t of targets) {
    onProgress?.(i, targets.length, t.name);
    const entry = bumpVersion(keyFor(t.kind, t.id, month, period), regenerate);
    const kindLabel = t.kind === "company" ? "업체" : "팀장";
    const folder = t.kind === "company" ? companyFolder : leaderFolder;
    const odFolder = `정산서_저장/${month}_${pLabel}/${kindLabel}`;
    const base = `${kindLabel}_${SAFE(t.name)}_${month}_${pLabel}_v${entry.version}`;
    if (t.pages.length === 1) {
      const blob = await renderJpg(t.pages[0]);
      folder.file(`${base}.jpg`, blob);
      if (options.uploadOneDrive) await uploadOneDrive(odFolder, `${base}.jpg`, blob);
    } else {
      let p = 1;
      for (const node of t.pages) {
        const blob = await renderJpg(node);
        const jpgName = `${base}_${p}.jpg`;
        folder.file(jpgName, blob);
        if (options.uploadOneDrive) await uploadOneDrive(odFolder, jpgName, blob);
        p++;
      }
    }
    i++;
  }
  onProgress?.(targets.length, targets.length, "");
  const blob = await zip.generateAsync({ type: "blob" });
  const filename = `정산서_저장_${month}_${pLabel}${regenerate ? "_재생성" : ""}.zip`;
  saveAs(blob, filename);
  return { filename, count: targets.length };
}

/**
 * 저장되는 JPG 와 동일한 이미지를 새 창에 띄워 인쇄한다.
 * - renderJpg 를 그대로 사용하므로 저장 사진과 1:1 일치
 * - 페이지마다 줄바꿈(@page A4) 적용
 */
export async function printTargets(
  targets: ExportTarget[],
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ count: number; pages: number }> {
  if (!targets.length) return { count: 0, pages: 0 };

  // 팝업은 사용자 제스처 동기 흐름 안에서 열어야 차단되지 않는다.
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) throw new Error("팝업이 차단되었습니다. 브라우저 팝업 차단을 해제해 주세요.");

  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>정산서 인쇄</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .sheet { display: block; width: 100%; page-break-after: always; break-after: page; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .sheet img { display: block; width: 100%; height: auto; }
  .loading { font: 14px system-ui, sans-serif; padding: 24px; color: #444; }
</style></head><body><div id="root"><div class="loading">정산서 이미지 준비 중…</div></div></body></html>`);
  win.document.close();

  const root = win.document.getElementById("root")!;
  root.innerHTML = "";

  let pageCount = 0;
  let i = 0;
  for (const t of targets) {
    onProgress?.(i, targets.length, t.name);
    for (const node of t.pages) {
      const blob = await renderJpg(node);
      const url = URL.createObjectURL(blob);
      const wrap = win.document.createElement("div");
      wrap.className = "sheet";
      const img = win.document.createElement("img");
      img.src = url;
      // 이미지 로드 완료 대기 — print 호출 전 모든 이미지가 그려져 있어야 함
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
      wrap.appendChild(img);
      root.appendChild(wrap);
      pageCount++;
    }
    i++;
  }
  onProgress?.(targets.length, targets.length, "");

  // 인쇄 다이얼로그 호출 (window.print 는 동기 — 다이얼로그 닫힐 때까지 블록)
  win.focus();
  try { win.print(); } catch { /* noop */ }

  return { count: targets.length, pages: pageCount };
}