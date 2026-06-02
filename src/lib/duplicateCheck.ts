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
  item?: string | null;
  metro_fee?: number | string | null;
  note_amount?: number | string | null;
  regional_fee?: number | string | null;
  cod_amount?: number | string | null;
  leader1_id?: string | null;
  leader2_id?: string | null;
  split_type?: string | null;
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
      && norm(e.leader1_id) === norm(candidate.leader1_id)
      && norm(e.leader2_id) === norm(candidate.leader2_id)
      && norm(e.split_type) === norm(candidate.split_type)
      && !!e.paid === !!candidate.paid
      && norm(e.note) === norm(candidate.note),
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
