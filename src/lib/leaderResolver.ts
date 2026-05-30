// 팀장 이름 인식/표시 유틸.
// - 정식 이름 + 별칭(aliases)으로 입력 문자열을 팀장에 매칭
// - 동명이인이 있을 때 display_suffix를 붙여 구분 표시

export interface LeaderLike {
  id: string;
  name: string;
  aliases?: string[] | null;
  display_suffix?: string | null;
  is_rejected?: boolean | null;
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

/**
 * 업체 제출용 표시 이름.
 * - 거부기사(is_rejected=true): 별칭1(aliases[0]) 사용, 없으면 "가상기사"
 * - 일반: 정식 팀장명
 * 정산 계산엔 절대 사용하지 말 것 (표시 전용).
 */
export function getCompanyFacingName<T extends LeaderLike>(leader: T): string {
  if (!leader.is_rejected) return leader.name.trim();
  const a1 = (leader.aliases ?? [])[0];
  const trimmed = String(a1 ?? "").trim();
  return trimmed || "가상기사";
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
    if (hit) {
      const reason =
        normLeaderName(hit.name) === k
          ? `팀장명 "${hit.name}"`
          : `"${hit.name}"의 별칭`;
      return `별칭 "${a}"이(가) 이미 ${reason}과 충돌합니다`;
    }
  }
  return null;
}

/**
 * 표시명(getDisplayName 결과) 중복 검사.
 * 동명이인이면 display_suffix까지 합쳐서 다른 팀장과 같은 표시가 되는지 확인.
 * 이름 변경 / 구분명 변경 직전에 호출.
 */
export function findDisplayNameConflict<T extends LeaderLike>(
  currentId: string,
  nextName: string,
  nextSuffix: string | null,
  leaders: T[],
): string | null {
  const others = leaders.filter((l) => l.id !== currentId);
  const nextCanon = String(nextName ?? "").trim();
  if (!nextCanon) return null;

  // 가상으로 본인 정보가 반영된 전체 목록을 만들어 동명이인 카운트 계산
  const virtual = others.concat([
    { id: currentId, name: nextCanon, aliases: [], display_suffix: nextSuffix } as T,
  ]);
  const dupCount = detectDuplicates(virtual).get(nextCanon) ?? 0;

  const myDisplay =
    dupCount > 1 && nextSuffix
      ? `${nextCanon}${nextSuffix.trim()}`
      : nextCanon;

  const clash = others.find((l) => getDisplayName(l, virtual) === myDisplay);
  if (clash) {
    if (dupCount > 1 && !nextSuffix) {
      return `동명이인 "${nextCanon}"이(가) 이미 존재합니다. 구분명을 입력하세요`;
    }
    return `표시명 "${myDisplay}"이(가) 이미 다른 팀장과 동일합니다`;
  }
  return null;
}