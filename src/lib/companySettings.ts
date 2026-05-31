// 회사 설정 (회사명/기본 정산월/기본 계좌번호/정산서 하단 안내문)
// — 모든 화면에서 공유되는 값. localStorage 사용자(uid) 스코프로 저장.

export type CompanySettings = {
  companyName: string;       // 예: 삼호물류
  defaultMonth: string;      // yyyy-mm
  defaultAccount: string;    // 회사 기본 계좌번호
  footerNote: string;        // 정산서 하단 안내문
  oeunkyuSpecial: boolean;   // 오은규 특수정산 적용 (기본 true)
};

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  companyName: "삼호물류",
  defaultMonth: new Date().toISOString().slice(0, 7),
  defaultAccount: "",
  footerNote: "정산 완료 후 입금자명을 전달 부탁드립니다.",
  oeunkyuSpecial: true,
};

const KEY = (uid: string) => `company.settings.${uid}`;

export function loadCompanySettings(uid: string): CompanySettings {
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (!raw) return DEFAULT_COMPANY_SETTINGS;
    return { ...DEFAULT_COMPANY_SETTINGS, ...(JSON.parse(raw) as Partial<CompanySettings>) };
  } catch {
    return DEFAULT_COMPANY_SETTINGS;
  }
}

export function saveCompanySettings(uid: string, v: CompanySettings) {
  try {
    localStorage.setItem(KEY(uid), JSON.stringify(v));
  } catch { /* noop */ }
}