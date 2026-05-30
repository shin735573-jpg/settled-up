import { Card } from "@/components/ui/card";

export default function Saves() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">정산서저장</h1>
      <Card className="p-6 text-sm text-muted-foreground">
        업체별·팀장별 정산서를 PNG로 생성하고 원드라이브 <code>정산서_저장/YYYY-MM</code> 폴더에 자동 백업하는 화면입니다. 정산 계산 로직이 완성되면 여기에서 일괄 저장 버튼이 활성화됩니다.
      </Card>
    </div>
  );
}