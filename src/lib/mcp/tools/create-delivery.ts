import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

export default defineTool({
  name: "create_delivery",
  title: "배송 기록 추가",
  description: "새 배송 기록을 추가합니다. 금액은 원 단위 숫자입니다.",
  inputSchema: {
    date: z.string().describe("배송 날짜 (YYYY-MM-DD)."),
    company_name: z.string().describe("업체명."),
    leader1_name: z.string().optional().describe("배송 팀장명."),
    customer_name: z.string().optional().describe("고객명."),
    region: z.string().optional().describe("배송 지역/주소."),
    item: z.string().optional().describe("품목."),
    note: z.string().optional().describe("비고."),
    metro_fee: z.number().optional().describe("수도권 배송비."),
    regional_fee: z.number().optional().describe("지방 배송비."),
    note_amount: z.number().optional().describe("비고 금액."),
    cod_amount: z.number().optional().describe("착불 금액 (보고용, 업체 청구에는 미포함)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const sb = supabaseForUser(ctx);
    const { data: company } = await sb
      .from("companies")
      .select("id,name")
      .ilike("name", input.company_name)
      .maybeSingle();
    const { data: leader } = input.leader1_name
      ? await sb.from("team_leaders").select("id,name").ilike("name", input.leader1_name).maybeSingle()
      : { data: null };

    const { data, error } = await sb
      .from("deliveries")
      .insert({
        user_id: ctx.getUserId(),
        date: input.date,
        company_id: company?.id ?? null,
        company_name: company?.name ?? input.company_name,
        leader1_id: leader?.id ?? null,
        leader1_name: leader?.name ?? input.leader1_name ?? null,
        customer_name: input.customer_name ?? null,
        region: input.region ?? null,
        item: input.item ?? null,
        note: input.note ?? null,
        metro_fee: input.metro_fee ?? 0,
        regional_fee: input.regional_fee ?? 0,
        note_amount: input.note_amount ?? 0,
        cod_amount: input.cod_amount ?? 0,
      })
      .select()
      .single();
    if (error) return errorResult(error.message);
    return { ...textResult(data), structuredContent: { row: data } };
  },
});