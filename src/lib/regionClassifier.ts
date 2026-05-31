// 지역(수도권/지방) 자동 분류기 — 키워드 사용자 편집 가능 (localStorage 영속)
export type RegionType = "metro" | "regional" | "unknown";

export const DEFAULT_METRO_KEYWORDS: string[] = [
  "서울","경기","인천",
  // 서울 25개 구
  "강남구","강동구","강북구","강서구","관악구","광진구","구로구","금천구","노원구","도봉구",
  "동대문구","동작구","마포구","서대문구","서초구","성동구","성북구","송파구","양천구",
  "영등포구","용산구","은평구","종로구","중랑구",
  // 경기/인천 시·구·동
  "수원","성남","분당","판교","용인","고양","일산","부천","안양","안산","화성","동탄","평택",
  "남양주","의정부","광명","시흥","김포","장기동","구래동","마산동","운양동","풍무동","사우동",
  "양촌","통진","고촌","파주","운정","문산","하남","미사","구리","군포","의왕","오산","이천",
  "안성","포천","양주","동두천","과천","여주","가평","양평","연천",
  "검단","청라","송도","부평","계양","남동구","연수구","미추홀구","강화","영종",
];

const KEY = (uid: string) => `region_metro_keywords:${uid || "anon"}`;

export function loadMetroKeywords(uid: string): string[] {
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (!raw) return [...DEFAULT_METRO_KEYWORDS];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [...DEFAULT_METRO_KEYWORDS];
    const clean = arr
      .map((x) => String(x ?? "").trim())
      .filter((x) => x.length > 0);
    return Array.from(new Set(clean));
  } catch {
    return [...DEFAULT_METRO_KEYWORDS];
  }
}

export function saveMetroKeywords(uid: string, list: string[]): void {
  try {
    const clean = Array.from(
      new Set(list.map((x) => String(x ?? "").trim()).filter(Boolean))
    );
    localStorage.setItem(KEY(uid), JSON.stringify(clean));
    // 다른 탭/페이지에 알림
    window.dispatchEvent(new CustomEvent("region-keywords-changed"));
  } catch {
    // ignore
  }
}

/**
 * 입력이 "동 이름만" 있는지 검사.
 * - 토큰 1개이고 한글로 끝이 '동'인 경우만 true.
 * - 시/구/도로명 등이 함께 있으면 false.
 * 예: "장기동" → true, "김포 장기동" → false
 */
export function isDongOnly(text: string): boolean {
  const s = (text || "").trim();
  if (!s) return false;
  // 공백/쉼표/슬래시 등으로 토큰 분리
  const tokens = s.split(/[\s,\/]+/).filter(Boolean);
  if (tokens.length !== 1) return false;
  return /^[가-힣]{1,8}동$/.test(tokens[0]);
}

export function classifyRegion(
  text: string,
  keywords?: string[]
): RegionType {
  const s = (text || "").trim();
  if (!s) return "unknown";
  const kws = keywords && keywords.length ? keywords : DEFAULT_METRO_KEYWORDS;
  // 인천/서울 시 표기와 함께 나오는 중구/서구는 수도권
  if (/(서울|인천)/.test(s) && /(중구|서구)/.test(s)) return "metro";
  for (const kw of kws) {
    if (kw && s.includes(kw)) return "metro";
  }
  return "regional";
}
