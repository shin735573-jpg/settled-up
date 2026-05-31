// PNG 생성 + ZIP 묶음 다운로드
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { bumpVersion, keyFor } from "./statementVersion";

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

async function renderPng(node: HTMLElement): Promise<Blob> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    cacheBust: true,
  });
  const res = await fetch(dataUrl);
  return await res.blob();
}

export async function exportSingle(
  target: ExportTarget,
  month: string,
  period: string,
  regenerate: boolean,
): Promise<{ filename: string; version: number; pages: number }> {
  const entry = bumpVersion(keyFor(target.kind, target.id, month, period), regenerate);
  const kindLabel = target.kind === "company" ? "업체" : "팀장";
  const pLabel = periodLabelKR(period);
  const base = `${kindLabel}_${SAFE(target.name)}_${month}_${pLabel}_v${entry.version}`;
  // 1장이면 단일 파일, 여러 장이면 ZIP 으로 묶어서 다운로드
  if (target.pages.length === 1) {
    const blob = await renderPng(target.pages[0]);
    const filename = `${base}.png`;
    saveAs(blob, filename);
    return { filename, version: entry.version, pages: 1 };
  }
  const zip = new JSZip();
  let i = 1;
  for (const node of target.pages) {
    const blob = await renderPng(node);
    zip.file(`${base}_${i}.png`, blob);
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
    const base = `${kindLabel}_${SAFE(t.name)}_${month}_${pLabel}_v${entry.version}`;
    if (t.pages.length === 1) {
      folder.file(`${base}.png`, await renderPng(t.pages[0]));
    } else {
      let p = 1;
      for (const node of t.pages) {
        folder.file(`${base}_${p}.png`, await renderPng(node));
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