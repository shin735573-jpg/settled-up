const normalizeItemName = (item: unknown): string =>
  String(item ?? "").trim().replace(/\s+/g, "");

const hasValue = (value: unknown): boolean => String(value ?? "").trim().length > 0;

export type VirtualSettlementRowLike = {
  virtual_leader_id?: string | null;
  virtual_leader_name?: string | null;
  leader1_id?: string | null;
  leader2_id?: string | null;
  leader3_id?: string | null;
};

export const isLoadingFeeItem = (item: unknown): boolean =>
  normalizeItemName(item) === "적재비";

/**
 * 팀장정산 제외 품목.
 * 정책 변경(2026-06): 적재비는 더 이상 제외하지 않는다 — 모든 정산(업체/팀장/본사/총배송비)에 포함하며
 * 팀장 귀속은 항상 "삼호" 팀장으로 자동 라우팅한다 (loadingFeeAssigneeName / normalizeLoadingFeeRowLeaders 참조).
 * 별도 제외 품목이 다시 생기면 여기에 추가한다.
 */
export const isLeaderSettlementExcludedItem = (_item: unknown): boolean => false;

/** 적재비를 귀속시킬 팀장 이름 (변경 불가 고정 규칙). */
export const loadingFeeAssigneeName = "삼호";

/**
 * leaders 목록에서 적재비 귀속 팀장(삼호) ID 집합과 기본 ID 를 찾는다.
 * "삼호"는 DB에 동명이인이 여러 명 등록될 수 있으므로 단일 ID 로 강제하면 안 된다.
 *  - ids: 이름이 정확히 "삼호" 인 모든 활성 팀장 ID 집합
 *  - primary: 기본 귀속 ID — 이미 어느 삼호에도 매핑되지 않은 적재비 행을 라우팅할 때 사용.
 *            우선순위: settle_to_id 가 없고 active 인 팀장 중 가장 먼저 발견된 것.
 */
export type LoadingFeeAssignee = { ids: Set<string>; primary: string | null };

export const findLoadingFeeAssignees = (
  leaders: ReadonlyArray<{
    id: string;
    name?: string | null;
    active?: boolean | null;
    settle_to_id?: string | null;
  }>,
): LoadingFeeAssignee => {
  const ids = new Set<string>();
  let primary: string | null = null;
  for (const l of leaders) {
    if (String(l.name ?? "").trim() !== loadingFeeAssigneeName) continue;
    ids.add(l.id);
    if (primary) continue;
    const isActive = l.active !== false;
    const isSelfSettling = !l.settle_to_id;
    if (isActive && isSelfSettling) primary = l.id;
  }
  // active/self-settling 후보가 없으면 그냥 첫 번째 발견한 ID
  if (!primary && ids.size > 0) primary = ids.values().next().value as string;
  return { ids, primary };
};

/** 하위호환: 단일 ID 헬퍼 — primary 반환. */
export const findLoadingFeeAssigneeId = (
  leaders: Parameters<typeof findLoadingFeeAssignees>[0],
): string | null => findLoadingFeeAssignees(leaders).primary;

/**
 * 적재비 행의 팀장 필드를 삼호 단독으로 정규화한 사본을 돌려준다.
 *  - 적재비가 아니면 그대로 반환.
 *  - 이미 leader1_id 가 어느 "삼호" ID 라면 그 ID 를 유지 (동명이인 보존).
 *  - 그렇지 않으면 primary 삼호 ID 로 강제 라우팅.
 *  - 어느 경우든 leader2/3, 분할/2인배송, 가상기사 입력은 모두 비워서 전액 단독 귀속.
 *  - 삼호 자체가 없으면 입력을 그대로 반환 (오작동보다 원본 보존이 안전).
 *
 * 두 번째 인자는 신/구 API 모두 지원:
 *  - LoadingFeeAssignee 객체  → 권장 (동명이인까지 보존)
 *  - string | null            → 레거시 (단일 ID; 항상 그 ID 로 강제)
 */
export const normalizeLoadingFeeRowLeaders = <T extends {
  item?: unknown;
  leader1_id?: string | null;
  leader2_id?: string | null;
  leader3_id?: string | null;
  virtual_leader_id?: string | null;
  virtual_leader_name?: string | null;
  split_type?: string | null;
  two_person?: boolean | null;
}>(row: T, assignee: LoadingFeeAssignee | string | null): T => {
  if (!isLoadingFeeItem(row.item)) return row;
  let a: LoadingFeeAssignee;
  if (assignee == null) {
    a = { ids: new Set<string>(), primary: null };
  } else if (typeof assignee === "string") {
    a = { ids: new Set<string>([assignee]), primary: assignee };
  } else {
    a = assignee;
  }
  // 이미 어느 삼호에 귀속되어 있으면 그 ID 유지
  const target = row.leader1_id && a.ids.has(row.leader1_id) ? row.leader1_id : a.primary;
  if (!target) return row;
  return {
    ...row,
    leader1_id: target,
    leader2_id: null,
    leader3_id: null,
    virtual_leader_id: null,
    virtual_leader_name: null,
    split_type: null,
    two_person: false,
  };
};

/** 가상기사 입력이 포함된 배송은 업체/팀장/본사 모든 정산에서 제외한다. */
export const isVirtualSettlementRow = (
  row: VirtualSettlementRowLike,
  virtualIds?: Set<string> | string[] | null,
): boolean => {
  if (hasValue(row.virtual_leader_id) || hasValue(row.virtual_leader_name)) return true;
  const ids = virtualIds instanceof Set ? virtualIds : new Set(virtualIds || []);
  return [row.leader1_id, row.leader2_id, row.leader3_id].some((id) => !!id && ids.has(id));
};

export const isSettlementExcludedRow = (
  row: VirtualSettlementRowLike & { item?: unknown },
  virtualIds?: Set<string> | string[] | null,
): boolean => isLeaderSettlementExcludedItem(row.item) || isVirtualSettlementRow(row, virtualIds);
