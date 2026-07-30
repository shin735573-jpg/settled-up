import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "list_deliveries",
  title: "배송 기록 조회",
  description: "기간/업체/팀장 조건으로 배송 기록을 조회합니다. 날짜는 YYYY-MM-DD 형식입니다.",
  inputSchema: {
    from: z.string().optional().describe("시작 날짜 (YYYY-MM-DD, 포함)."),
    to: z.string().optional().describe("종료 날짜 (YYYY-MM-DD, 포함)."),
    company_name: z.string().optional().describe("업체명 부분 일치 필터."),
    leader_name: z.string().optional().describe("팀장명 부분 일치 필터 (1번 팀장 기준)."),
    limit: z.number().optional().describe("최대 반환 행 수. 기본 100, 최대 500."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, company_name, leader_name, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const max = Math.min(Math.max(Math.trunc(limit ?? 100), 1), 500);
    let q = supabaseForUser(ctx)
      .from("deliveries")
      .select(
        "id,date,company_name,leader1_name,leader2_name,leader3_name,customer_name,region,item,note,metro_fee,note_amount,regional_fee,cod_amount,paid,two_person,split_type",
      )
      .order("date", { ascending: false })
      .limit(max);
    if (from) q = q.gte("date", from);
    if (to) q = q.lte("date", to);
    if (company_name) q = q.ilike("company_name", `%${company_name}%`);
    if (leader_name) q = q.ilike("leader1_name", `%${leader_name}%`);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return { ...textResult(data ?? []), structuredContent: { rows: data ?? [], count: data?.length ?? 0 } };
  },
});