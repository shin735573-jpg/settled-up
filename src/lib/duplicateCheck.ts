// 기록입력 저장 전 중복 검사 (순수 함수, 테스트 가능).
//  - 정확 중복: 날짜, 업체, 고객명, 품목, 배송합계, 착불, 팀장1, 팀장2,
//               분할, 결제유무, 비고까지 모두 일치
//  - 의심 중복: 날짜, 업체, 고객명, 품목, 배송합계만 일치

export type DupDelivery = {
  id?: string | null;
  date?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  region?: string | null;
  item?: string | null;
  metro_fee?: number | string | null;
  note_amount?: number | string | null;
  regional_fee?: number | string | null;
  cod_amount?: number | string | null;
  leader1_id?: string | null;
  leader2_id?: string | null;
  split_type?: string | null;
  two_person?: boolean | null;
  paid?: boolean | null;
  note?: string | null;
};

const num = (v: unknown) => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const norm = (v: unknown) => String(v ?? "").trim();
const totalFee = (d: DupDelivery) =>
  num(d.metro_fee) + num(d.note_amount) + num(d.regional_fee);
const companyKey = (d: DupDelivery) =>
  norm(d.company_id) || norm(d.company_name).toLowerCase();
const dateK = (d: DupDelivery) => norm(d.date).slice(0, 10);

export type DuplicateMatch = {
  id: string;
  date: string;
  company: string;
  customer: string;
  item: string;
  fee: number;
  cod: number;
};

const toMatch = (e: DupDelivery): DuplicateMatch => ({
  id: norm(e.id),
  date: dateK(e),
  company: norm(e.company_name),
  customer: norm(e.customer_name),
  item: norm(e.item),
  fee: totalFee(e),
  cod: num(e.cod_amount),
});

const baseMatch = (a: DupDelivery, b: DupDelivery) =>
  dateK(a) === dateK(b)
  && companyKey(a) === companyKey(b)
  && norm(a.customer_name) === norm(b.customer_name)
  && norm(a.region).toLowerCase() === norm(b.region).toLowerCase()
  && norm(a.item) === norm(b.item)
  && totalFee(a) === totalFee(b);

const sameId = (a: DupDelivery, b: DupDelivery) =>
  !!a.id && !!b.id && a.id === b.id;

export function findExactDuplicates(
  candidate: DupDelivery,
  existing: DupDelivery[],
): DuplicateMatch[] {
  return existing
    .filter((e) => !sameId(e, candidate))
    .filter((e) =>
      baseMatch(e, candidate)
      && num(e.cod_amount) === num(candidate.cod_amount)
      && num(e.metro_fee) === num(candidate.metro_fee)
      && num(e.note_amount) === num(candidate.note_amount)
      && num(e.regional_fee) === num(candidate.regional_fee)
      && norm(e.leader1_id) === norm(candidate.leader1_id)
      && norm(e.leader2_id) === norm(candidate.leader2_id)
      && norm(e.split_type) === norm(candidate.split_type)
      && !!e.two_person === !!candidate.two_person
      && !!e.paid === !!candidate.paid
    )
    .map(toMatch);
}

export function findSuspectDuplicates(
  candidate: DupDelivery,
  existing: DupDelivery[],
): DuplicateMatch[] {
  const exactSet = new Set(findExactDuplicates(candidate, existing).map((m) => m.id));
  return existing
    .filter((e) => !sameId(e, candidate))
    .filter((e) => baseMatch(e, candidate))
    .map(toMatch)
    .filter((m) => !exactSet.has(m.id));
}

export function formatDuplicateConfirm(
  exact: DuplicateMatch[],
  suspect: DuplicateMatch[],
): string {
  const lines: string[] = [];
  const fmt = (m: DuplicateMatch) =>
    `  - [${m.id.slice(0, 8)}] ${m.date} ${m.company || "?"} / ${m.customer || "?"} / ${m.item || "?"} / 배송 ${m.fee.toLocaleString()}원`;
  if (exact.length) {
    lines.push(`정확 중복 ${exact.length}건`);
    exact.slice(0, 5).forEach((m) => lines.push(fmt(m)));
    if (exact.length > 5) lines.push(`  … 외 ${exact.length - 5}건`);
  }
  if (suspect.length) {
    if (lines.length) lines.push("");
    lines.push(`의심 중복 ${suspect.length}건`);
    suspect.slice(0, 5).forEach((m) => lines.push(fmt(m)));
    if (suspect.length > 5) lines.push(`  … 외 ${suspect.length - 5}건`);
  }
  if (lines.length) {
    lines.push("");
    lines.push("그대로 저장하시겠습니까?");
  }
  return lines.join("\n");
}

export function hasAnyDuplicates(
  exact: DuplicateMatch[],
  suspect: DuplicateMatch[],
): boolean {
  return exact.length > 0 || suspect.length > 0;
}

// 대량 저장(엑셀 붙여넣기/여러건 저장) 전 중복 검사.
//  - 후보들끼리 서로 중복인 경우와 기존 데이터와의 중복을 함께 검사한다.
//  - 결과는 후보별이 아닌, 전체에서 발생한 정확/의심 중복의 합쳐진 매치 리스트.
//  - 중복 매치는 매치 id 기준으로 한 번만 카운트한다(같은 기존 행이 여러 후보와
//    충돌해도 1건으로 표시).
export function findBulkDuplicates(
  candidates: DupDelivery[],
  existing: DupDelivery[],
): { exact: DuplicateMatch[]; suspect: DuplicateMatch[] } {
  const exactMap = new Map<string, DuplicateMatch>();
  const suspectMap = new Map<string, DuplicateMatch>();
  const keyOf = (m: DuplicateMatch, i: number) =>
    m.id || `${m.date}|${m.company}|${m.customer}|${m.item}|${m.fee}|${m.cod}|${i}`;
  candidates.forEach((cand, idx) => {
    // 기존 데이터 + 자기 자신을 제외한 다른 후보들과 비교
    const others = candidates.filter((_, i) => i !== idx);
    const pool = [...existing, ...others];
    const ex = findExactDuplicates(cand, pool);
    const sus = findSuspectDuplicates(cand, pool);
    ex.forEach((m) => {
      const k = keyOf(m, idx);
      if (!exactMap.has(k)) exactMap.set(k, m);
    });
    sus.forEach((m) => {
      const k = keyOf(m, idx);
      if (!exactMap.has(k) && !suspectMap.has(k)) suspectMap.set(k, m);
    });
  });
  return { exact: [...exactMap.values()], suspect: [...suspectMap.values()] };
}

// 대량 저장 시 후보별 분류 — 완전 중복은 자동 제외, 유사 중복은 경고만.
//  - exactDupRows: 기존 또는 다른 후보와 완전 중복인 후보 (저장에서 제외 권장)
//  - suspectRows : 유사 중복이 발견된 후보 (사용자 확인 후 진행)
//  - newRows     : 중복 없는 신규 후보
export function summarizeBulk(
  candidates: DupDelivery[],
  existing: DupDelivery[],
): {
  total: number;
  newCount: number;
  exactDupCount: number;
  suspectCount: number;
  newRows: DupDelivery[];
  exactDupRows: DupDelivery[];
  suspectRows: DupDelivery[];
  exactMatches: DuplicateMatch[];
  suspectMatches: DuplicateMatch[];
} {
  const newRows: DupDelivery[] = [];
  const exactDupRows: DupDelivery[] = [];
  const suspectRows: DupDelivery[] = [];
  const exactMatches: DuplicateMatch[] = [];
  const suspectMatches: DuplicateMatch[] = [];
  // 후보가 자기들끼리 정확 중복이면 첫 번째 한 건만 신규로 두고 나머지는 exactDup
  const seenExact = new Set<string>();
  candidates.forEach((cand, idx) => {
    const others = candidates.filter((_, i) => i !== idx);
    const pool = [...existing, ...others];
    const ex = findExactDuplicates(cand, pool);
    const sus = findSuspectDuplicates(cand, pool);
    if (ex.length > 0) {
      // 후보끼리 정확 중복이라면 첫 번째는 신규로 살리고 나머지는 제외
      const sig = [
        cand.date, cand.company_id || cand.company_name, cand.customer_name,
        cand.region, cand.item, cand.metro_fee, cand.note_amount,
        cand.regional_fee, cand.cod_amount, cand.leader1_id, cand.leader2_id,
        cand.split_type, cand.two_person, cand.paid,
      ].join("|");
      const hasExistingExact = ex.some((m) => existing.find((e) => e.id === m.id));
      if (!hasExistingExact && !seenExact.has(sig)) {
        seenExact.add(sig);
        newRows.push(cand);
        return;
      }
      exactDupRows.push(cand);
      ex.forEach((m) => exactMatches.push(m));
      return;
    }
    if (sus.length > 0) {
      suspectRows.push(cand);
      sus.forEach((m) => suspectMatches.push(m));
    }
    newRows.push(cand);
  });
  return {
    total: candidates.length,
    newCount: newRows.length,
    exactDupCount: exactDupRows.length,
    suspectCount: suspectRows.length,
    newRows,
    exactDupRows,
    suspectRows,
    exactMatches,
    suspectMatches,
  };
}

// 관리자용: 로드된 배송 목록에서 "중복 의심" 그룹을 만든다.
//  - 그룹 키: 날짜|업체|고객|배송지|품목|배송합계 (의심 중복 기준)
//  - 2건 이상 모인 그룹만 반환
//  - 그룹 안에서 "정확 중복"인 행과 그렇지 않은 "의심" 행을 함께 표시
export type DuplicateGroup = {
  key: string;
  date: string;
  company: string;
  customer: string;
  region: string;
  item: string;
  fee: number;
  rows: DupDelivery[];
  exactPairs: number; // 그룹 내에서 서로 완전 중복인 쌍 수
};

export function groupSuspectDuplicates(rows: DupDelivery[]): DuplicateGroup[] {
  const map = new Map<string, DupDelivery[]>();
  const keyOf = (r: DupDelivery) => [
    String(r.date ?? "").slice(0, 10),
    String(r.company_id ?? r.company_name ?? "").toLowerCase().trim(),
    String(r.customer_name ?? "").trim(),
    String(r.region ?? "").toLowerCase().trim(),
    String(r.item ?? "").trim(),
    num(r.metro_fee) + num(r.note_amount) + num(r.regional_fee),
  ].join("|");
  for (const r of rows) {
    const k = keyOf(r);
    const arr = map.get(k) || [];
    arr.push(r);
    map.set(k, arr);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, rs] of map.entries()) {
    if (rs.length < 2) continue;
    // 정확 중복 쌍 수
    let pairs = 0;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        if (findExactDuplicates(rs[i], [rs[j]]).length > 0) pairs++;
      }
    }
    const first = rs[0];
    groups.push({
      key,
      date: String(first.date ?? "").slice(0, 10),
      company: String(first.company_name ?? ""),
      customer: String(first.customer_name ?? ""),
      region: String(first.region ?? ""),
      item: String(first.item ?? ""),
      fee: num(first.metro_fee) + num(first.note_amount) + num(first.regional_fee),
      rows: rs,
      exactPairs: pairs,
    });
  }
  // 정확중복 쌍 많은 순 → 날짜 내림차순
  groups.sort((a, b) => b.exactPairs - a.exactPairs || b.date.localeCompare(a.date));
  return groups;
}
