import OcrCheckPanel from "@/components/OcrCheckPanel";

export default function OcrTest() {
  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">OCR 정확도 테스트</h1>
        <p className="text-sm text-muted-foreground">샘플 이미지에 기대값(정답)을 입력하고 분석하여 필드별 일치도를 점검합니다.</p>
      </div>
      <OcrCheckPanel max={10} />
    </div>
  );
}
