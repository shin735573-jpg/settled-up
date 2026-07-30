import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, supabaseForUser, textResult } from "../supabase";

type Row = {
  company_name: string | null;
  leader1_name: string | null;
  metro_fee: number | null;
  note_amount: number | null;
  regional_fee: number | null;
  cod_amount: number | null;
};

export default defineTool({
  name: "settlement_summary",
  title: "기간 정산 요약",
  description:
    "지정한 기간의 배송비 합계를 업체별/팀장별로 집계합니다. 착불(cod)은 보고용으로 별도 표시되며 배송비 합계에는 포함되지 않습니다.",
  inputSchema: {
    from: z.string().describe("시작 날짜 (YYYY-MM-DD, 포함)."),
    to: z.string().describe("종료 날짜 (YYYY-MM-DD, 포함)."),
    group_by: z.string().optional().describe("집계 기준: 'company' 또는 'leader'. 기본 'company'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, group_by }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const key = group_by === "leader" ? "leader1_name" : "company_name";
    const { data, error } = await supabaseForUser(ctx)
      .from("deliveries")
      .select("company_name,leader1_name,metro_fee,note_amount,regional_fee,cod_amount")
      .gte("date", from)
      .lte("date", to);
    if (error) return errorResult(error.message);

    const acc = new Map<string, { name: string; count: number; delivery_fee: number; cod: number }>();
    for (const r of (data ?? []) as Row[]) {
      const name = (r[key] as string | null) || "(미지정)";
      const cur = acc.get(name) ?? { name, count: 0, delivery_fee: 0, cod: 0 };
      cur.count += 1;
      cur.delivery_fee += Number(r.metro_fee ?? 0) + Number(r.note_amount ?? 0) + Number(r.regional_fee ?? 0);
      cur.cod += Number(r.cod_amount ?? 0);
      acc.set(name, cur);
    }
    const groups = [...acc.values()].sort((a, b) => b.delivery_fee - a.delivery_fee);
    const total = groups.reduce((s, g) => s + g.delivery_fee, 0);
    const payload = { from, to, group_by: key === "leader1_name" ? "leader" : "company", total_delivery_fee: total, groups };
    return { ...textResult(payload), structuredContent: payload };
  },
});