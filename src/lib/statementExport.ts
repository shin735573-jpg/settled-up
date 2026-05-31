// PNG 생성 + ZIP 묶음 다운로드
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { bumpVersion, keyFor } from "./statementVersion";

export type ExportTarget = {
  kind: "company" | "leader";
  id: string;
  name: string;
  node: HTMLElement;
};

const SAFE = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim();

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
): Promise<{ filename: string; version: number }> {
  const blob = await renderPng(target.node);
  const entry = bumpVersion(keyFor(target.kind, target.id, month, period), regenerate);
  const kindLabel = target.kind === "company" ? "업체" : "팀장";
  const filename = `${kindLabel}_${SAFE(target.name)}_${month}_${period}_v${entry.version}.png`;
  saveAs(blob, filename);
  return { filename, version: entry.version };
}

export async function exportZip(
  targets: ExportTarget[],
  month: string,
  period: string,
  regenerate: boolean,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ filename: string; count: number }> {
  const zip = new JSZip();
  let i = 0;
  for (const t of targets) {
    onProgress?.(i, targets.length, t.name);
    const blob = await renderPng(t.node);
    const entry = bumpVersion(keyFor(t.kind, t.id, month, period), regenerate);
    const kindLabel = t.kind === "company" ? "업체" : "팀장";
    const folder = zip.folder(kindLabel)!;
    folder.file(`${kindLabel}_${SAFE(t.name)}_${month}_${period}_v${entry.version}.png`, blob);
    i++;
  }
  onProgress?.(targets.length, targets.length, "");
  const blob = await zip.generateAsync({ type: "blob" });
  const filename = `정산서_${month}_${period}${regenerate ? "_재생성" : ""}.zip`;
  saveAs(blob, filename);
  return { filename, count: targets.length };
}