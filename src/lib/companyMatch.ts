// 업체 매칭 유틸. 과거 데이터에서 company_id가 null인 행을
// company_name으로 폴백 매칭한다. id가 있으면 id 일치만 인정하므로
// 다른 업체에 절대 섞이지 않는다.

export const normCompanyName = (s: unknown): string =>
  String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");

export interface CompanyLike {
  id: string;
  name: string;
}

export interface DeliveryLike {
  company_id: string | null;
  company_name?: string | null;
}

export const matchesCompany = (r: DeliveryLike, c: CompanyLike): boolean => {
  if (r.company_id) return r.company_id === c.id;
  return !!c?.name && normCompanyName(r.company_name) === normCompanyName(c.name);
};