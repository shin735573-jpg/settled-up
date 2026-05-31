// 복구 전(前) 안전 검증.
// 백업 파일에서 파싱한 데이터로 "절대 금지" 규칙을 점검해
// 통과하지 못하면 복구 실행 자체를 막는다.
//
// 점검 항목:
//  A. 업체·팀장 데이터 섞임
//     A1. companies.id 와 team_leaders.id 가 동일한 행 (PK 충돌)
//     A2. 동일 이름이 양쪽 시트에 모두 존재 (논리적 혼동)
//     A3. deliveries.company_id 가 team_leaders.id 와 일치
//     A4. deliveries.leader{1,2,3}_id 가 companies.id 와 일치
//  B. 계산서 미발행 문구 노출 (auditDeliveries 의 submission 모드 에러)
//     - 거부팀장 별칭 누락 → 실명 노출 위험
//     - 가상기사/가상팀장이 배송에 포함 또는 문구로 입력됨
//     - 미발행 업체 안내(info) 는 차단하지 않고 안내만

import { auditDeliveries, type AuditFinding } from "./liveAudit";
import type { ParsedBackup } from "./excelBackup";

export type RestoreValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  detail?: string;
};

export type RestoreValidationResult = {
  issues: RestoreValidationIssue[];
  errors: RestoreValidationIssue[];
  warnings: RestoreValidationIssue[];
  ok: boolean;
};

type AnyRow = Record<string, unknown>;

function rowsOf(parsed: ParsedBackup, table: string): AnyRow[] {
  return (parsed.tables.find((t) => t.table === table)?.rows ?? []) as AnyRow[];
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}
function norm(v: unknown): string {
  return str(v).toLowerCase();
}

/**
 * 선택된 시트만 검증한다. (선택되지 않은 시트는 무시 — 복구 대상이 아니므로)
 * companies/team_leaders/deliveries 의 교차 검증이 핵심이므로 셋 중 하나만 골라도
 * 의미 있는 점검이 되도록 "선택되지 않은 시트"는 비교 기준으로만 활용한다.
 */
export function validateBackupForRestore(
  parsed: ParsedBackup,
  selectedTables: string[],
): RestoreValidationResult {
  const issues: RestoreValidationIssue[] = [];
  const push = (
    severity: "error" | "warning",
    code: string,
    message: string,
    detail?: string,
  ) => issues.push({ severity, code, message, detail });

  const companies = rowsOf(parsed, "companies");
  const leaders = rowsOf(parsed, "team_leaders");
  const deliveries = rowsOf(parsed, "deliveries");

  const wantsCompanies = selectedTables.includes("companies");
  const wantsLeaders = selectedTables.includes("team_leaders");
  const wantsDeliveries = selectedTables.includes("deliveries");

  // ── A1. PK 섞임 ──────────────────────────────────────────────
  if (wantsCompanies || wantsLeaders) {
    const coIds = new Set(companies.map((c) => str(c.id)).filter(Boolean));
    const leIds = new Set(leaders.map((l) => str(l.id)).filter(Boolean));
    const dup: string[] = [];
    for (const id of coIds) if (leIds.has(id)) dup.push(id);
    if (dup.length > 0) {
      push(
        "error",
        "id_collision_company_leader",
        `업체·팀장 ID 충돌 ${dup.length}건 — 동일 ID가 양쪽 시트에 존재`,
        dup.slice(0, 5).join(", ") + (dup.length > 5 ? " …" : ""),
      );
    }
  }

  // ── A2. 이름 섞임 ────────────────────────────────────────────
  if (wantsCompanies && wantsLeaders) {
    const coNames = new Map<string, string>();
    for (const c of companies) {
      const n = norm(c.name);
      if (n) coNames.set(n, str(c.name));
    }
    const collide: string[] = [];
    for (const l of leaders) {
      const n = norm(l.name);
      if (n && coNames.has(n)) collide.push(coNames.get(n)!);
    }
    if (collide.length > 0) {
      push(
        "warning",
        "name_collision_company_leader",
        `업체명·팀장명 중복 ${collide.length}건 — 화면 혼동 가능`,
        Array.from(new Set(collide)).slice(0, 5).join(", "),
      );
    }
  }

  // ── A3/A4. 배송 참조 ID 가 반대 시트로 향함 ───────────────────
  if (wantsDeliveries) {
    const coIdSet = new Set(companies.map((c) => str(c.id)).filter(Boolean));
    const leIdSet = new Set(leaders.map((l) => str(l.id)).filter(Boolean));
    let companyAsLeader = 0;
    let leaderAsCompany = 0;
    for (const d of deliveries) {
      const cid = str(d.company_id);
      if (cid && leIdSet.has(cid) && !coIdSet.has(cid)) companyAsLeader++;
      for (const k of ["leader1_id", "leader2_id", "leader3_id"]) {
        const lid = str(d[k]);
        if (lid && coIdSet.has(lid) && !leIdSet.has(lid)) leaderAsCompany++;
      }
    }
    if (companyAsLeader > 0) {
      push(
        "error",
        "delivery_company_is_leader",
        `배송 ${companyAsLeader}건의 업체 ID 가 팀장 ID 와 동일 — 데이터 섞임`,
      );
    }
    if (leaderAsCompany > 0) {
      push(
        "error",
        "delivery_leader_is_company",
        `배송 ${leaderAsCompany}건의 팀장 ID 가 업체 ID 와 동일 — 데이터 섞임`,
      );
    }
  }

  // ── B. 노출 금지 규칙 (auditDeliveries) ────────────────────────
  // 거부팀장 별칭 누락, 가상기사/팀장 노출 → 업체 제출 모드 기준 에러로 간주.
  if (wantsDeliveries && deliveries.length > 0) {
    const audit = auditDeliveries({
      deliveries: deliveries as never,
      companies: companies as never,
      leaders: leaders as never,
      mode: "submission",
    });
    for (const f of audit.errors) addAuditFinding(push, f, "error");
    // 정보성(미발행 업체 명단)은 워닝으로만 보여줌 — 차단 X
    for (const f of audit.warnings) addAuditFinding(push, f, "warning");
    for (const f of audit.infos) {
      if (f.code === "non_invoice_company" || f.code === "non_invoice_leader") {
        addAuditFinding(push, f, "warning");
      }
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { issues, errors, warnings, ok: errors.length === 0 };
}

function addAuditFinding(
  push: (s: "error" | "warning", c: string, m: string, d?: string) => void,
  f: AuditFinding,
  sev: "error" | "warning",
) {
  push(sev, f.code, f.message, f.detail);
}