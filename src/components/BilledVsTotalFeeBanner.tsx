import { Card } from "@/components/ui/card";
import { fmt } from "@/lib/format";
import type { BilledVsTotalFeeResult } from "@/lib/billedVsTotalFeeCheck";

/**
 * 업체 청구(VAT 전) ↔ 총배송비 자동 비교 결과 배너.
 * - ok: 초록색, VAT 차이만 존재 (정상)
 * - !ok: 빨간색, VAT 외 잔차 존재 (재방문 1차 행 규칙 불일치 등 의심)
 */
export function BilledVsTotalFeeBanner({ result }: { result: BilledVsTotalFeeResult }) {
  if (result.ok) {
    return (
      <Card className="p-4 border-green-500/40 bg-green-500/5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-green-700 dark:text-green-400">
              청구·총배송비 정합성 OK — VAT 차이만 존재
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              청구(VAT전) = 총배송비. 부가세만큼만 최종 청구가 더 큼.
            </div>
          </div>
          <div className="text-xs num text-muted-foreground">
            총배송비 <span className="font-semibold">{fmt(result.totalFee)}</span> ·
            청구(VAT전) <span className="font-semibold">{fmt(result.preVatSum)}</span> ·
            VAT <span className="font-semibold">{fmt(result.vatSum)}</span> ·
            최종청구 <span className="font-semibold">{fmt(result.billedSum)}</span>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-4 border-destructive/50 bg-destructive/5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-destructive">
            ⚠ 청구·총배송비 정합성 오류 — VAT 외 잔차 발생
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {result.message}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            의심 원인: 재방문 1차 행 선택 규칙 불일치 · 착불상계로 0 클램프된 업체 ·
            가상기사 분류 차이 등. 업체정산/팀장정산 화면에서 항목별 차이를 확인하세요.
          </div>
        </div>
        <div className="text-xs num text-muted-foreground">
          총배송비 <span className="font-semibold">{fmt(result.totalFee)}</span> ·
          청구(VAT전) <span className="font-semibold">{fmt(result.preVatSum)}</span> ·
          차이 <span className="font-semibold text-destructive">{fmt(result.diff)}</span>
        </div>
      </div>
    </Card>
  );
}
