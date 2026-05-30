import { Card } from "@/components/ui/card";

export default function HQSettlement() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">본사정산</h1>
      <Card className="p-6 text-sm text-muted-foreground">
        본사(삼호) 정산 화면 자리표시자입니다. 업체별 수수료·세금계산서 발행 여부·VAT 포함 여부를 반영한 본사 정산 표가 여기에 표시됩니다.
      </Card>
    </div>
  );
}