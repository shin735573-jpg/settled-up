import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

interface PrintButtonProps {
  label?: string;
  documentTitle?: string;
  className?: string;
}

/**
 * 인쇄/PDF 저장 버튼.
 * - 브라우저의 window.print()를 호출 (사용자가 인쇄 또는 PDF로 저장 선택 가능)
 * - 인쇄 중 document.title을 일시 변경하여 PDF 파일명 기본값으로 사용
 */
export default function PrintButton({ label = "인쇄 / PDF", documentTitle, className }: PrintButtonProps) {
  const handlePrint = () => {
    const prev = document.title;
    if (documentTitle) document.title = documentTitle;
    const restore = () => {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handlePrint}
      className={`no-print print:hidden ${className ?? ""}`}
    >
      <Printer className="h-4 w-4 mr-1" />
      {label}
    </Button>
  );
}