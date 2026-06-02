import { supabase } from "@/integrations/supabase/client";

// 통합 이력 기록/복구용 헬퍼.
// 통합은 "여러 row → 1개 row + 나머지 삭제"이므로, 복구를 위해
// (a) 기준 row의 통합 전/후 스냅샷 (b) 삭제될 row들의 전체 스냅샷 을 저장한다.

export type DeliverySnapshot = Record<string, unknown> & { id: string };

export type MergeAction = "merge_companion" | "merge_two_person";

export async function recordMergeLog(opts: {
  userId: string;
  baseRowId: string;
  action: MergeAction;
  baseBefore: DeliverySnapshot;
  baseAfter: DeliverySnapshot;
  mergedRows: DeliverySnapshot[];
}) {
  if (!opts.mergedRows.length) return { error: null };
  const { error } = await supabase.from("delivery_merge_log").insert({
    user_id: opts.userId,
    base_row_id: opts.baseRowId,
    merge_action: opts.action,
    base_before: opts.baseBefore as never,
    base_after: opts.baseAfter as never,
    merged_rows: opts.mergedRows as never,
  });
  return { error };
}

// 통합 해제: 기준 row를 통합 전 값으로 되돌리고, 삭제됐던 row들을 다시 insert.
export async function revertMergeLog(logId: string) {
  const { data: log, error: fetchErr } = await supabase
    .from("delivery_merge_log")
    .select("*")
    .eq("id", logId)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr };
  if (!log) return { error: new Error("통합 이력을 찾을 수 없습니다") };
  if (log.reverted_at) return { error: new Error("이미 통합 해제된 이력입니다") };

  const baseBefore = log.base_before as DeliverySnapshot;
  const mergedRows = (log.merged_rows as DeliverySnapshot[]) ?? [];

  // 1) 기준 row를 통합 전 값으로 되돌림
  const restorePatch: Record<string, unknown> = { ...baseBefore };
  delete restorePatch.id;
  delete restorePatch.created_at;
  delete restorePatch.dedupe_key;
  restorePatch.updated_at = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("deliveries")
    .update(restorePatch as never)
    .eq("id", log.base_row_id);
  if (upErr) return { error: upErr };

  // 2) 삭제됐던 row들을 다시 insert (원래 id 유지)
  if (mergedRows.length > 0) {
    const inserts = mergedRows.map((r) => {
      const copy: Record<string, unknown> = { ...r };
      delete copy.dedupe_key; // 트리거가 다시 계산
      return copy;
    });
    const { error: insErr } = await supabase
      .from("deliveries")
      .insert(inserts as never);
    if (insErr) return { error: insErr };
  }

  // 3) 이력에 복구 시점 기록
  const { error: markErr } = await supabase
    .from("delivery_merge_log")
    .update({ reverted_at: new Date().toISOString() })
    .eq("id", logId);
  return { error: markErr };
}