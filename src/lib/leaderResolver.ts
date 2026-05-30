// 팀장 이름 인식/표시 유틸.
// - 정식 이름 + 별칭(aliases)으로 입력 문자열을 팀장에 매칭
// - 동명이인이 있을 때 display_suffix를 붙여 구분 표시

export interface LeaderLike {
  id: string;
  name: string;
  aliases?: string[] | null;
  display_suffix?: string | null;
}

export const normLeaderName = (s: unknown): string =>
  String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");

/** 입력 문자열을 정식 팀장에 매칭. 정식 이름 우선, 그 다음 별칭. */
export function resolveLeaderName<T extends LeaderLike>(
  input: string | null | undefined,
  leaders: T[],
): T | null {
  const key = normLeaderName(input);
  if (!key) return null;
  // 1) 정식 이름 정확 매치
  const byName = leaders.find((l) => normLeaderName(l.name) === key);
  if (byName) return byName;
  // 2) 별칭 매치
  const byAlias = leaders.find((l) =>
    (l.aliases ?? []).some((a) => normLeaderName(a) === key),
  );
  return byAlias ?? null;
}

/** 정식 이름을 정규화한다 (별칭 → 정식 이름). 매칭 실패 시 입력값 trim. */
export function canonicalLeaderName<T extends LeaderLike>(
  input: string | null | undefined,
  leaders: T[],
): string {
  const m = resolveLeaderName(input, leaders);
  return m ? m.name : String(input ?? "").trim();
}

/** 동명이인 그룹 (정식 이름 기준 count). */
export function detectDuplicates<T extends LeaderLike>(leaders: T[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of leaders) {
    const k = l.name.trim();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** 표시 이름: 동명이인이면 display_suffix를 붙여 구분 (예: "김민수2"). */
export function getDisplayName<T extends LeaderLike>(leader: T, leaders: T[]): string {
  const dup = detectDuplicates(leaders).get(leader.name.trim()) ?? 0;
  if (dup > 1 && leader.display_suffix) {
    return `${leader.name.trim()}${leader.display_suffix.trim()}`;
  }
  return leader.name.trim();
}

/** 별칭 중복 검사 (클라이언트). 같은 사용자 내에서 alias가 다른 팀장 이름/별칭과 충돌하면 메시지 반환. */
export function findAliasConflict<T extends LeaderLike>(
  currentId: string,
  aliases: string[],
  leaders: T[],
): string | null {
  for (const a of aliases) {
    const k = normLeaderName(a);
    if (!k) continue;
    const hit = leaders.find(
      (l) =>
        l.id !== currentId &&
        (normLeaderName(l.name) === k ||
          (l.aliases ?? []).some((x) => normLeaderName(x) === k)),
    );
    if (hit) return `별칭 "${a}"가 이미 "${hit.name}"에서 사용 중입니다`;
  }
  return null;
}