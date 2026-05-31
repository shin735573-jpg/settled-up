// 전체 데이터 엑셀 백업 — 모든 테이블을 시트별로 추출해 .xlsx 로 만든다.
// 로컬 다운로드 / OneDrive 업로드 / 자동 백업 (24h 1회) 모두 지원.

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { supabase } from "@/integrations/supabase/client";

/** 백업 대상 테이블 정의 — 추가/변경 시 여기만 수정 */
const TABLES: Array<{ name: string; sheet: string }> = [
  { name: "companies", sheet: "업체" },
  { name: "team_leaders", sheet: "팀장" },
  { name: "deliveries", sheet: "배송기록" },
  { name: "holidays", sheet: "휴무일" },
  { name: "common_deductions", sheet: "공통공제" },
  { name: "leader_common_overrides", sheet: "팀장별공제오버라이드" },
  { name: "leader_period_deductions", sheet: "팀장기간공제" },
  { name: "price_list", sheet: "단가표" },
];

type Row = Record<string, unknown>;

async function fetchAll(table: string, uid: string): Promise<Row[]> {
  // 1000행 제한 우회 — 페이지네이션
  const PAGE = 1000;
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table as never)
      .select("*")
      .eq("user_id", uid)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function setSheetFromRows(ws: ExcelJS.Worksheet, rows: Row[]) {
  if (rows.length === 0) {
    ws.addRow(["(데이터 없음)"]);
    return;
  }
  // 모든 행의 키 집합을 헤더로 사용 — null/undefined 컬럼 누락 방지
  const headerSet = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) headerSet.add(k);
  const headers = Array.from(headerSet);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  for (const r of rows) {
    ws.addRow(
      headers.map((h) => {
        const v = r[h];
        if (v === null || v === undefined) return "";
        if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
        return v as string | number | boolean;
      }),
    );
  }
  // 컬럼 폭 자동 조정 (간단 휴리스틱)
  ws.columns.forEach((col) => {
    let max = 8;
    col.eachCell?.({ includeEmpty: false }, (c) => {
      const len = String(c.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(40, Math.max(10, max + 2));
  });
}

/** 모든 테이블을 읽어 ExcelJS Workbook → Blob 으로 직렬화 */
export async function buildBackupBlob(uid: string): Promise<{ blob: Blob; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "삼호정산표";
  wb.created = new Date();

  // 메타 시트
  const meta = wb.addWorksheet("백업정보");
  meta.addRow(["항목", "값"]).font = { bold: true };
  meta.addRow(["사용자ID", uid]);
  meta.addRow(["백업시각", new Date().toISOString()]);
  meta.addRow(["스키마버전", "1"]);

  for (const t of TABLES) {
    const ws = wb.addWorksheet(t.sheet);
    try {
      const rows = await fetchAll(t.name, uid);
      meta.addRow([t.sheet, `${rows.length}건`]);
      setSheetFromRows(ws, rows);
    } catch (e) {
      meta.addRow([t.sheet, `오류: ${(e as Error).message}`]);
      ws.addRow(["조회 실패", (e as Error).message]);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `삼호정산표_백업_${stamp}.xlsx`;
  return { blob, filename };
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

export type BackupOptions = {
  /** 로컬 파일로 다운로드 */
  download?: boolean;
  /** OneDrive 의 "삼호정산표_백업" 폴더로 업로드 */
  uploadOneDrive?: boolean;
};

export async function runBackup(
  uid: string,
  options: BackupOptions = { download: true },
): Promise<{ filename: string; size: number; uploaded: boolean }> {
  if (!uid) throw new Error("로그인이 필요합니다.");
  const { blob, filename } = await buildBackupBlob(uid);
  if (options.download) saveAs(blob, filename);
  let uploaded = false;
  if (options.uploadOneDrive) {
    const contentBase64 = await blobToBase64(blob);
    const { data, error } = await supabase.functions.invoke("onedrive-upload", {
      body: {
        action: "upload",
        folder: "삼호정산표_백업",
        filename,
        contentBase64,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
    if (error) throw new Error(`OneDrive 업로드 실패: ${error.message}`);
    if (data?.error) throw new Error(`OneDrive 업로드 실패: ${data.error}`);
    uploaded = true;
  }
  // 마지막 백업 시각 기록
  try {
    localStorage.setItem(`backup.lastAt.${uid}`, new Date().toISOString());
  } catch { /* noop */ }
  return { filename, size: blob.size, uploaded };
}

// ─── 자동 백업 (24h 1회) ──────────────────────────────────
const AUTO_KEY = (uid: string) => `backup.auto.${uid}`;
const LAST_KEY = (uid: string) => `backup.lastAt.${uid}`;

export function getAutoBackupEnabled(uid: string): boolean {
  try {
    return localStorage.getItem(AUTO_KEY(uid)) === "1";
  } catch { return false; }
}

export function setAutoBackupEnabled(uid: string, enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(AUTO_KEY(uid), "1");
    else localStorage.removeItem(AUTO_KEY(uid));
  } catch { /* noop */ }
}

export function getLastBackupAt(uid: string): string | null {
  try { return localStorage.getItem(LAST_KEY(uid)); } catch { return null; }
}

/**
 * 24시간이 지났고 자동백업이 켜져 있으면 백업 1회 실행.
 * 옵션: OneDrive에도 자동 업로드. 실패는 조용히 무시 (콘솔 경고만).
 */
export async function maybeRunDailyBackup(
  uid: string,
  options: { uploadOneDrive?: boolean } = {},
): Promise<boolean> {
  if (!uid) return false;
  if (!getAutoBackupEnabled(uid)) return false;
  const last = getLastBackupAt(uid);
  if (last) {
    const ageMs = Date.now() - new Date(last).getTime();
    if (Number.isFinite(ageMs) && ageMs < 24 * 60 * 60 * 1000) return false;
  }
  try {
    await runBackup(uid, { download: true, uploadOneDrive: !!options.uploadOneDrive });
    return true;
  } catch (e) {
    console.warn("[autoBackup] 실패:", (e as Error).message);
    return false;
  }
}