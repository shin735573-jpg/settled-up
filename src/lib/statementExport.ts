// JPG 생성 + ZIP 묶음 다운로드 (카톡 공유 최적화)
import { toJpeg } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { bumpVersion, keyFor } from "./statementVersion";
import { supabase } from "@/integrations/supabase/client";

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
  // 1장이면 단일 파일, 여러 장이면 ZIP 으로 묶어서 다운로드
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