import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listCompanies from "./tools/list-companies";
import listLeaders from "./tools/list-leaders";
import listDeliveries from "./tools/list-deliveries";
import settlementSummary from "./tools/settlement-summary";
import createDelivery from "./tools/create-delivery";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "settled-up",
  title: "정산의 달인",
  version: "0.1.0",
  instructions:
    "가구/침대 배송 정산 앱의 도구 모음입니다. 업체·팀장 목록 조회, 기간별 배송 기록 조회, 업체/팀장별 정산 요약 집계, 배송 기록 추가를 지원합니다. 착불(cod) 금액은 보고용이며 업체 청구 금액에 포함되지 않습니다.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listCompanies, listLeaders, listDeliveries, settlementSummary, createDelivery],
});