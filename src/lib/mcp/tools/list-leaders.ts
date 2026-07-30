import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "list_team_leaders",
  title: "팀장 목록 조회",
  description: "로그인한 사용자의 배송 팀장(기사) 목록을 조회합니다.",
  inputSchema: {
    active_only: z.boolean().optional().describe("활성 팀장만 조회할지 여부. 기본값 true."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ active_only }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let q = supabaseForUser(ctx).from("team_leaders").select("*").order("name");
    if (active_only !== false) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return { ...textResult(data ?? []), structuredContent: { leaders: data ?? [] } };
  },
});