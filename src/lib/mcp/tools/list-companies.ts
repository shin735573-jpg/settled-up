import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "list_companies",
  title: "업체 목록 조회",
  description: "로그인한 사용자의 거래 업체(회사) 목록과 정산 설정(세금계산서 발행/부가세 포함/정산주기/요율)을 조회합니다.",
  inputSchema: {
    active_only: z.boolean().optional().describe("활성 업체만 조회할지 여부. 기본값 true."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ active_only }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    let q = supabaseForUser(ctx)
      .from("companies")
      .select("id,name,active,issues_invoice,vat_included,settlement_cycle,fee_rate_metro,fee_rate_regional,has_cod,account_number")
      .order("name");
    if (active_only !== false) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return { ...textResult(data ?? []), structuredContent: { companies: data ?? [] } };
  },
});