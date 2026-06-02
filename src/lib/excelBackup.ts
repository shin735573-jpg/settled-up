// 전체 데이터 엑셀 백업 — 모든 테이블을 시트별로 추출해 .xlsx 로 만든다.
// 로컬 다운로드 / OneDrive 업로드 / 자동 백업 (24h 1회) 모두 지원.

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { supabase } from "@/integrations/supabase/client";
import {
  buildCompanyStatements,
  buildLeaderStatements,
  detectSpecialLeaderIds,
  setSpecialOneTimeItems,
  type PeriodKey,
  type StmtCompany,
  type StmtDelivery,
  type StmtLeader,
  type StmtCommonDeduction,
  type StmtCommonOverride,
  type StmtPeriodDeduction,
  type DeductionContext,
} from "./statementData";
import { loadCompanySettings } from "./companySettings";

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

/** 단순 시트 빌더 — 헤더 + 행 배열 */
function writeSheet(
  ws: ExcelJS.Worksheet,
  headers: string[],
  rows: Array<Array<string | number | boolean | null>>,
) {
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  for (const r of rows) ws.addRow(r.map((v) => (v === null || v === undefined ? "" : v)));
  ws.columns.forEach((col) => {
    let max = 8;
    col.eachCell?.({ includeEmpty: false }, (c) => {
      const len = String(c.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(40, Math.max(10, max + 2));
  });
}

function collectMonths(deliveries: StmtDelivery[]): string[] {
  const set = new Set<string>();
  for (const d of deliveries) {
    const m = (d.date || "").slice(0, 7);
    if (m) set.add(m);
  }
  return Array.from(set).sort();
}

/**
 * 모든 월·기간에 대해 정산서를 돌려 상세/요약 시트 4종을 추가.
 * 백업 전용 — 복구(restoreBackup)는 TABLES 만 읽으므로 이 시트들은 자동 무시된다.
 */
function addDetailSheets(
  wb: ExcelJS.Workbook,
  uid: string,
  raw: Record<string, Row[]>,
) {
  const companies = (raw.companies ?? []) as unknown as StmtCompany[];
  const leaders = (raw.team_leaders ?? []) as unknown as StmtLeader[];
  const deliveries = (raw.deliveries ?? []) as unknown as StmtDelivery[];
  const commonDeductions = (raw.common_deductions ?? []) as unknown as StmtCommonDeduction[];
  const commonOverrides = (raw.leader_common_overrides ?? []) as unknown as StmtCommonOverride[];
  const periodDeductions = (raw.leader_period_deductions ?? []) as unknown as StmtPeriodDeduction[];

  const settings = loadCompanySettings(uid);
  const special = detectSpecialLeaderIds(leaders);
  const months = collectMonths(deliveries);

  const companyDetailRows: Array<Array<string | number | boolean | null>> = [];
  const leaderDetailRows: Array<Array<string | number | boolean | null>> = [];
  const companySummaryRows: Array<Array<string | number | boolean | null>> = [];
  const leaderSummaryRows: Array<Array<string | number | boolean | null>> = [];

  const PERIODS: PeriodKey[] = ["h1", "h2", "all"];

  for (const month of months) {
    const monthly = deliveries.filter((d) => (d.date || "").startsWith(month));
    for (const period of PERIODS) {
      const companyStmts = buildCompanyStatements(monthly, companies, leaders, period);
      for (const cs of companyStmts) {
        companySummaryRows.push([
          month, period, cs.company.name,
          cs.rows.length, cs.feeTotal, cs.paidTotal, cs.unpaidTotal,
          cs.codTotal, cs.realClaim, cs.vat, cs.claimWithVat,
        ]);
        for (const r of cs.rows) {
          companyDetailRows.push([
            month, period, cs.company.name,
            r.date, r.customer_name ?? "", r.item ?? "", r.region ?? "",
            r.display_leader1, r.display_leader2, r.display_leader3,
            Number(r.metro_fee), Number(r.note_amount), Number(r.regional_fee),
            r.delivery_fee, Number(r.cod_amount),
            r.paid ? "Y" : "N", r.note ?? "",
          ]);
        }
      }

      const periodKey = period === "all" ? "all" : `${month}-${period === "h1" ? "first" : "second"}`;
      const commonPeriodKeys = period === "all"
        ? [`${month}-first`, `${month}-second`]
        : [periodKey];
      const deductionCtx: DeductionContext = {
        commonDeductions, commonOverrides, periodDeductions,
        periodKey, commonPeriodKeys,
      };
      const leaderStmts = buildLeaderStatements(
        monthly, leaders, period,
        { ...special, oeunkyuSpecial: settings.oeunkyuSpecial },
        deductionCtx,
      );
      for (const ls of leaderStmts) {
        leaderSummaryRows.push([
          month, period, ls.leader.name,
          ls.deliveryCount, ls.realFee, ls.feeTotal, ls.afterFee,
          ls.codSum, ls.deductionTotal, ls.payout, ls.vat, ls.payoutWithVat,
        ]);
        for (const r of ls.rows) {
          leaderDetailRows.push([
            month, period, ls.leader.name,
            r.delivery.date,
            r.delivery.company_name ?? "",
            r.delivery.customer_name ?? "",
            r.delivery.item ?? "",
            r.delivery.region ?? "",
            r.share.weight,
            r.share.metro, r.share.note_amount, r.share.regional, r.share.cod,
            r.unitFee, r.unitAfterFee, r.unitPayout,
            r.delivery.split_type ?? "",
            r.delivery.two_person ? "Y" : "N",
            r.share.reason ?? "",
          ]);
        }
      }
    }
  }

  writeSheet(wb.addWorksheet("업체별상세"), [
    "월", "기간", "업체", "날짜", "고객", "품목", "지역",
    "팀장1", "팀장2", "팀장3",
    "수도권배송비", "비고금액", "지방배송비", "배송비합", "착불",
    "완료(Y/N)", "비고",
  ], companyDetailRows);

  writeSheet(wb.addWorksheet("팀장별상세"), [
    "월", "기간", "팀장", "날짜", "업체", "고객", "품목", "지역",
    "분배가중치", "분배수도권", "분배비고", "분배지방", "분배착불",
    "수수료", "계산후", "실지급(차감전)", "분할유형", "2인동행", "사유",
  ], leaderDetailRows);

  writeSheet(wb.addWorksheet("업체정산요약"), [
    "월", "기간", "업체", "건수", "배송비합계", "완료합계", "미완료합계",
    "착불합계", "실청구", "부가세", "청구총액(VAT포함)",
  ], companySummaryRows);

  writeSheet(wb.addWorksheet("팀장정산요약"), [
    "월", "기간", "팀장", "건수", "실배송비", "수수료", "계산후",
    "착불", "공제합계", "실지급", "부가세", "지급총액(VAT포함)",
  ], leaderSummaryRows);
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

  const rawData: Record<string, Row[]> = {};

  for (const t of TABLES) {
    const ws = wb.addWorksheet(t.sheet);
    try {
      const rows = await fetchAll(t.name, uid);
      rawData[t.name] = rows;
      meta.addRow([t.sheet, `${rows.length}건`]);
      setSheetFromRows(ws, rows);
    } catch (e) {
      meta.addRow([t.sheet, `오류: ${(e as Error).message}`]);
      ws.addRow(["조회 실패", (e as Error).message]);
    }
  }

  // ─── 정산 상세 시트 (팀장·업체별, 백업 전용 — 복구 시 무시됨) ───
  try {
    try {
      const { data: si } = await supabase
        .from("special_items" as never)
        .select("label,active")
        .eq("user_id", uid);
      const labels = ((si as Array<{ label: string; active: boolean }> | null) ?? [])
        .filter((r) => r.active)
        .map((r) => String(r.label || "").trim())
        .filter((l) => l.length > 0);
      if (labels.length > 0) setSpecialOneTimeItems(labels);
    } catch { /* ignore */ }
    addDetailSheets(wb, uid, rawData);
    meta.addRow(["정산상세시트", "생성됨 (팀장별상세/업체별상세/요약 2종)"]);
  } catch (e) {
    meta.addRow(["정산상세시트", `오류: ${(e as Error).message}`]);
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

// ─── 자동 백업 (6시간 1회, 이중 백업: 로컬 .xlsx + OneDrive) ───────
export const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const AUTO_KEY = (uid: string) => `backup.auto.${uid}`;
const AUTO_OD_KEY = (uid: string) => `backup.autoOneDrive.${uid}`;
const LAST_KEY = (uid: string) => `backup.lastAt.${uid}`;
const LAST_OK_KEY = (uid: string) => `backup.lastOk.${uid}`;

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

export function getAutoOneDriveEnabled(uid: string): boolean {
  try { return localStorage.getItem(AUTO_OD_KEY(uid)) === "1"; } catch { return false; }
}
export function setAutoOneDriveEnabled(uid: string, enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(AUTO_OD_KEY(uid), "1");
    else localStorage.removeItem(AUTO_OD_KEY(uid));
  } catch { /* noop */ }
}

export function getLastBackupAt(uid: string): string | null {
  try { return localStorage.getItem(LAST_KEY(uid)); } catch { return null; }
}

/**
 * 6시간이 지났고 자동백업이 켜져 있으면 이중 백업(로컬 .xlsx + 선택 시 OneDrive) 1회 실행.
 * 실패는 조용히 무시 (콘솔 경고만).
 */
export async function maybeRunPeriodicBackup(
  uid: string,
  options: { uploadOneDrive?: boolean; intervalMs?: number } = {},
): Promise<boolean> {
  if (!uid) return false;
  if (!getAutoBackupEnabled(uid)) return false;
  const interval = options.intervalMs ?? BACKUP_INTERVAL_MS;
  const last = getLastBackupAt(uid);
  if (last) {
    const ageMs = Date.now() - new Date(last).getTime();
    if (Number.isFinite(ageMs) && ageMs < interval) return false;
  }
  // OneDrive 자동 업로드: 인자로 명시되지 않았으면 설정값 사용
  const wantOD = options.uploadOneDrive ?? getAutoOneDriveEnabled(uid);
  try {
    await runBackup(uid, { download: true, uploadOneDrive: wantOD });
    try { localStorage.setItem(LAST_OK_KEY(uid), new Date().toISOString()); } catch { /* noop */ }
    return true;
  } catch (e) {
    console.warn("[autoBackup] 실패:", (e as Error).message);
    return false;
  }
}

/** 하위 호환: 기존 이름 유지 */
export const maybeRunDailyBackup = maybeRunPeriodicBackup;

/**
 * 앱 마운트 시 한 번 호출. 즉시 1회 시도 후, 30분 간격으로 백업 필요 여부를 점검한다.
 * - 자동백업 OFF면 아무 일도 하지 않음 (점검만)
 * - 6시간 경과 시 이중 백업 (로컬 .xlsx 다운로드 + OneDrive 업로드[옵션])
 * - 반환값: cleanup 함수
 */
export function startAutoBackupScheduler(uid: string): () => void {
  if (!uid) return () => {};
  let cancelled = false;
  const CHECK_MS = 30 * 60 * 1000; // 30분마다 조건 확인
  const tick = () => {
    if (cancelled) return;
    void maybeRunPeriodicBackup(uid);
  };
  // 초기 짧은 지연 후 1회
  const initialT = window.setTimeout(tick, 2000);
  const intervalT = window.setInterval(tick, CHECK_MS);
  // 탭 다시 포커스 받을 때도 점검 (장시간 sleep 후 깨어난 경우)
  const onFocus = () => tick();
  window.addEventListener("focus", onFocus);
  return () => {
    cancelled = true;
    window.clearTimeout(initialT);
    window.clearInterval(intervalT);
    window.removeEventListener("focus", onFocus);
  };
}

// ─── 복구 (Restore) ────────────────────────────────────────
// 백업 파일(.xlsx)을 읽어 선택한 테이블을 안전하게 복원한다.

/** sheet 이름 → DB 테이블 이름 역매핑 */
const SHEET_TO_TABLE: Record<string, string> = TABLES.reduce(
  (acc, t) => { acc[t.sheet] = t.name; return acc; },
  {} as Record<string, string>,
);

export type ParsedTable = {
  /** DB 테이블 이름 */
  table: string;
  /** 시트 이름 (한글) */
  sheet: string;
  /** 헤더 목록 */
  headers: string[];
  /** 변환된 행 (user_id 제거된 상태) */
  rows: Row[];
};

export type ParsedBackup = {
  meta: Record<string, string>;
  tables: ParsedTable[];
};

function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // 날짜 컬럼이면 YYYY-MM-DD, 타임스탬프면 ISO — 호출부에서 컬럼별 판단 안 함.
    // Postgres는 ISO 둘 다 허용하므로 ISO 사용.
    return v.toISOString();
  }
  if (typeof v === "object") {
    // ExcelJS rich text / formula / hyperlink 객체 처리
    const obj = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof obj.text === "string") return obj.text;
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join("");
    if (obj.result !== undefined) return obj.result;
    return JSON.stringify(v);
  }
  return v;
}

function normalizeRow(headers: string[], rawRow: unknown[]): Row {
  const out: Row = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    let v = cellValue(rawRow[i]);
    if (v === "") v = null;
    // JSON 직렬화된 배열/객체 복원 (aliases 등)
    if (typeof v === "string") {
      const s = v.trim();
      if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
        try { v = JSON.parse(s); } catch { /* keep string */ }
      }
    }
    out[h] = v;
  }
  return out;
}

/** 백업 파일 파싱 — 검증 포함. 유효하지 않으면 throw. */
export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch (e) {
    throw new Error(`엑셀 파일을 읽을 수 없습니다: ${(e as Error).message}`);
  }

  // 메타 수집 (선택)
  const meta: Record<string, string> = {};
  const metaWs = wb.getWorksheet("백업정보");
  if (metaWs) {
    metaWs.eachRow((row) => {
      const k = String(cellValue(row.getCell(1).value) ?? "").trim();
      const v = String(cellValue(row.getCell(2).value) ?? "").trim();
      if (k && k !== "항목") meta[k] = v;
    });
  }

  const tables: ParsedTable[] = [];
  for (const t of TABLES) {
    const ws = wb.getWorksheet(t.sheet);
    if (!ws) continue;
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col - 1] = String(cellValue(cell.value) ?? "").trim();
    });
    if (headers.length === 0) continue;
    if (headers[0] === "(데이터 없음)") {
      tables.push({ table: t.name, sheet: t.sheet, headers: [], rows: [] });
      continue;
    }

    const rows: Row[] = [];
    const rowCount = ws.rowCount;
    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const raw: unknown[] = [];
      let hasAny = false;
      for (let c = 1; c <= headers.length; c++) {
        const v = row.getCell(c).value;
        if (v !== null && v !== undefined && v !== "") hasAny = true;
        raw.push(v);
      }
      if (!hasAny) continue;
      const norm = normalizeRow(headers, raw);
      // user_id 는 복구 시 현재 사용자로 강제 — 파일 값 무시
      delete (norm as Record<string, unknown>).user_id;
      rows.push(norm);
    }
    tables.push({ table: t.name, sheet: t.sheet, headers, rows });
  }

  if (tables.length === 0) {
    throw new Error("백업 파일에서 복구 가능한 시트를 찾지 못했습니다.");
  }
  return { meta, tables };
}

export type BatchError = {
  batchIndex: number;
  count: number;
  message: string;
};

export type RestoreResult = {
  table: string;
  sheet: string;
  total: number;          // 전체 행 수
  inserted: number;       // 성공적으로 적용된 행 수
  deleted: number;        // 삭제된 행 수 (replace 모드)
  skipped: number;        // 오류로 인해 건너뛴 행 수
  error?: string;          // 전체 실패 시 오류 메시지
  batchErrors?: BatchError[];
};

export type RestoreMode = "upsert" | "replace";

/**
 * 선택된 테이블만 복구.
 * - "upsert": id 기준 병합 (기존 데이터 유지, 동일 id 는 덮어씀)
 * - "replace": 해당 사용자의 데이터 전체 삭제 후 재삽입
 * 항상 user_id 는 현재 로그인 사용자로 고정.
 */
export async function restoreBackup(
  uid: string,
  parsed: ParsedBackup,
  selectedTables: string[],
  mode: RestoreMode,
): Promise<RestoreResult[]> {
  if (!uid) throw new Error("로그인이 필요합니다.");
  const results: RestoreResult[] = [];
  const BATCH = 500;

  for (const t of parsed.tables) {
    if (!selectedTables.includes(t.table)) continue;
    const res: RestoreResult = {
      table: t.table,
      sheet: t.sheet,
      total: t.rows.length,
      inserted: 0,
      deleted: 0,
      skipped: 0,
      batchErrors: [],
    };
    try {
      if (mode === "replace") {
        const { error: delErr, count } = await supabase
          .from(t.table as never)
          .delete({ count: "exact" })
          .eq("user_id", uid);
        if (delErr) throw new Error(`삭제 실패: ${delErr.message}`);
        res.deleted = count ?? 0;
      }

      // 행 준비 — user_id 부여
      const payload = t.rows.map((r) => ({ ...r, user_id: uid }));
      for (let i = 0; i < payload.length; i += BATCH) {
        const chunk = payload.slice(i, i + BATCH);
        if (chunk.length === 0) continue;
        const q = supabase.from(t.table as never);
        const { error } =
          mode === "upsert"
            ? await q.upsert(chunk as never, { onConflict: "id" })
            : await q.insert(chunk as never);
        if (error) {
          res.batchErrors!.push({
            batchIndex: Math.floor(i / BATCH) + 1,
            count: chunk.length,
            message: error.message,
          });
          res.skipped += chunk.length;
        } else {
          res.inserted += chunk.length;
        }
      }
    } catch (e) {
      res.error = (e as Error).message;
      // 전체 실패 시 미적용 행을 skipped 에 반영
      const remaining = t.rows.length - res.inserted - res.skipped;
      if (remaining > 0) res.skipped += remaining;
    }
    results.push(res);
  }
  return results;
}

/** 라벨 헬퍼 */
export function tableLabel(table: string): string {
  return TABLES.find((t) => t.name === table)?.sheet ?? table;
}

export const RESTORABLE_TABLES = TABLES.map((t) => ({ table: t.name, sheet: t.sheet }));