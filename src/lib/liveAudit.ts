// 라이브 자동 검증 (경고) 로직.
// 정산 화면에서 현재 기간의 원본 deliveries / companies / team_leaders 만으로
// 다음 3가지를 즉시 점검한다.
//
//  1) 계산서 미발행 대상 — issues_invoice=false 인 업체/팀장이 노출되는 화면에서
//     사용자가 부가세/계산서 금액을 잘못 인식하지 않도록 대상 명단을 안내.
//  2) 거부업체 숨김    — 업체의 rejected_leader_id(1~3) 에 해당하는 팀장이 배송에
//     포함됐는데 업체 제출용 별칭(aliases[0])이 비어 있으면 오류.
//  3) 내부/제출용 문구 분리 — "가상기사" / "가상팀장" / is_virtual=true 팀장이 업체
//     제출 화면에 나타나면 오류, 본사/팀장 내부 화면이면 경고.
//
// 정산 계산엔 영향 없음 (화면용 검증 전용).

import { isMissingCompanyAlias } from "./leaderResolver";

export type AuditMode = "submission" | "internal";

export type AuditFinding = {
  severity: "error" | "warning" | "info";
  code:
    | "non_invoice_company"
    | "non_invoice_leader"
    | "rejected_leader_missing_alias"
    | "rejected_leader_real_name"
    | "virtual_leader_exposed"
    | "virtual_term_in_text";
  message: string;
  detail?: string;
};

export type AuditResult = {
  findings: AuditFinding[];
  errors: AuditFinding[];
  warnings: AuditFinding[];
  infos: AuditFinding[];
  ok: boolean;
};

type Co = {
  id: string; name: string;
  issues_invoice?: boolean | null;
  rejected_leader_id?: string | null;
  rejected_leader_id_2?: string | null;
  rejected_leader_id_3?: string | null;
};
type Le = {
  id: string; name: string;
  aliases?: string[] | null;
  is_rejected?: boolean | null;
  is_virtual?: boolean | null;
  issues_invoice?: boolean | null;
};
type De = {
  id?: string; date?: string | null;
  company_id?: string | null; company_name?: string | null;
  leader1_id?: string | null; leader1_name?: string | null;
  leader2_id?: string | null; leader2_name?: string | null;
  leader3_id?: string | null; leader3_name?: string | null;
  note?: string | null; item?: string | null;
};

const VIRTUAL_TERMS = ["가상기사", "가상팀장"];

const empty = (): AuditResult => ({
  findings: [], errors: [], warnings: [], infos: [], ok: true,
});

function add(r: AuditResult, f: AuditFinding) {
  r.findings.push(f);
  if (f.severity === "error") { r.errors.push(f); r.ok = false; }
  else if (f.severity === "warning") r.warnings.push(f);
  else r.infos.push(f);
}

export function auditDeliveries(opts: {
  deliveries: De[];
  companies: Co[];
  leaders: Le[];
  mode: AuditMode;
  /** 업체 상세 모드일 때, 그 업체만 점검하도록 제한 (선택) */
  scopedCompanyId?: string | null;
}): AuditResult {
  const r = empty();
  const { deliveries, companies, leaders, mode, scopedCompanyId } = opts;

  const coById = new Map(companies.map((c) => [c.id, c]));
  const leById = new Map(leaders.map((l) => [l.id, l]));

  // ── 1) 계산서 미발행 대상 안내 ─────────────────────────────────
  // 현재 기간에 실제 배송이 있는 대상만 안내한다.
  {
    const coDeliveryCount = new Map<string, number>();
    const leDeliveryCount = new Map<string, number>();
    for (const d of deliveries) {
      if (d.company_id) coDeliveryCount.set(d.company_id, (coDeliveryCount.get(d.company_id) || 0) + 1);
      for (const id of [d.leader1_id, d.leader2_id, d.leader3_id]) {
        if (id) leDeliveryCount.set(id, (leDeliveryCount.get(id) || 0) + 1);
      }
    }
    const noInvCompanies = companies.filter((c) =>
      c.issues_invoice === false &&
      (coDeliveryCount.get(c.id) ?? 0) > 0 &&
      (!scopedCompanyId || c.id === scopedCompanyId),
    );
    if (noInvCompanies.length > 0) {
      add(r, {
        severity: "info",
        code: "non_invoice_company",
        message: `계산서 미발행 업체 ${noInvCompanies.length}곳 — 부가세/계산서 금액 표시 금지`,
        detail: noInvCompanies.map((c) => c.name).join(", "),
      });
    }
    if (mode === "internal" && !scopedCompanyId) {
      const noInvLeaders = leaders.filter((l) =>
        l.issues_invoice === false && (leDeliveryCount.get(l.id) ?? 0) > 0,
      );
      if (noInvLeaders.length > 0) {
        add(r, {
          severity: "info",
          code: "non_invoice_leader",
          message: `계산서 미발급 팀장 ${noInvLeaders.length}명 — 부가세 표시 금지`,
          detail: noInvLeaders.map((l) => l.name).join(", "),
        });
      }
    }
  }

  // ── 2) 거부업체 / 거부팀장 노출 점검 ──────────────────────────
  // 업체별 거부팀장이 배송에 있을 때, 별칭 미등록이면 오류.
  // 제출용(mode=submission)이면 별칭이 있어도 "실명 직접 노출 가능성"이 있으므로
  //   화면에서 별칭으로 치환되는지 호출 측에서 보장해야 한다.
  {
    const rejectedAliasMissing = new Set<string>(); // `${companyId}|${leaderId}`
    const rejectedReal = new Set<string>();         // 정보용
    for (const d of deliveries) {
      const co = d.company_id ? coById.get(d.company_id) : null;
      if (!co) continue;
      if (scopedCompanyId && co.id !== scopedCompanyId) continue;
      const rejIds = [co.rejected_leader_id, co.rejected_leader_id_2, co.rejected_leader_id_3]
        .filter(Boolean) as string[];
      if (rejIds.length === 0) continue;
      const rejSet = new Set(rejIds);
      for (const lid of [d.leader1_id, d.leader2_id, d.leader3_id]) {
        if (!lid || !rejSet.has(lid)) continue;
        const le = leById.get(lid);
        if (!le) continue;
        if (isMissingCompanyAlias(le)) {
          rejectedAliasMissing.add(`${co.id}|${lid}`);
        } else {
          rejectedReal.add(`${co.id}|${lid}`);
        }
      }
    }
    if (rejectedAliasMissing.size > 0) {
      const names = Array.from(rejectedAliasMissing).map((k) => {
        const [cid, lid] = k.split("|");
        const co = coById.get(cid);
        const le = leById.get(lid);
        return `${co?.name ?? "?"} ↔ ${le?.name ?? "?"}`;
      });
      add(r, {
        severity: "error",
        code: "rejected_leader_missing_alias",
        message: `거부팀장 표시용 별칭 누락 ${rejectedAliasMissing.size}건 — 업체 제출 시 실명이 노출됩니다`,
        detail: names.join(" / "),
      });
    }
    if (mode === "submission" && rejectedReal.size > 0) {
      // 제출용 화면에서는 실명 자리에 별칭이 들어갔는지 호출자가 보장해야 함을 안내.
      add(r, {
        severity: "info",
        code: "rejected_leader_real_name",
        message: `거부팀장 ${rejectedReal.size}건 — 업체 제출용은 반드시 별칭으로 표시`,
      });
    }
  }

  // ── 3) 가상기사 / 가상팀장 노출 점검 ──────────────────────────
  {
    const virtualLeaderIds = new Set<string>();
    const virtualTextRows: string[] = [];
    for (const d of deliveries) {
      for (const lid of [d.leader1_id, d.leader2_id, d.leader3_id]) {
        if (!lid) continue;
        const le = leById.get(lid);
        if (le?.is_virtual) virtualLeaderIds.add(lid);
      }
      for (const nm of [d.leader1_name, d.leader2_name, d.leader3_name, d.note, d.item]) {
        if (nm && VIRTUAL_TERMS.some((t) => nm.includes(t))) {
          virtualTextRows.push(`${d.date ?? "?"} ${nm}`);
          break;
        }
      }
    }
    if (virtualLeaderIds.size > 0) {
      const names = Array.from(virtualLeaderIds)
        .map((id) => leById.get(id)?.name ?? "?")
        .join(", ");
      add(r, {
        severity: mode === "submission" ? "error" : "warning",
        code: "virtual_leader_exposed",
        message: `가상기사/가상팀장 ${virtualLeaderIds.size}명이 배송에 포함됨`,
        detail: names,
      });
    }
    if (virtualTextRows.length > 0) {
      add(r, {
        severity: mode === "submission" ? "error" : "warning",
        code: "virtual_term_in_text",
        message: `"가상기사"/"가상팀장" 문구가 입력 데이터에 포함됨 (${virtualTextRows.length}건)`,
        detail: virtualTextRows.slice(0, 5).join(" · ") + (virtualTextRows.length > 5 ? " …" : ""),
      });
    }
  }

  return r;
}