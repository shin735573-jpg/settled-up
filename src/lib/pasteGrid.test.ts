import { describe, expect, it } from "vitest";
import { isSkippablePasteRow, parsePastedTableText } from "./pasteGrid";

describe("parsePastedTableText", () => {
  it("엑셀 TSV 16개 행을 한 건도 누락하지 않고 읽는다", () => {
    const header = ["날짜", "업체", "고객명", "배송지", "품목", "수도권배송비"].join("\t");
    const rows = Array.from({ length: 16 }, (_, i) => [
      i === 0 ? "2026-06-01" : "",
      "테스트업체",
      `고객${i + 1}`,
      `서울 ${i + 1}`,
      `품목${i + 1}`,
      "10000",
    ].join("\t"));

    const parsed = parsePastedTableText([header, ...rows].join("\n"));

    expect(parsed).toHaveLength(17);
    expect(parsed.slice(1)).toHaveLength(16);
    expect(parsed[16][2]).toBe("고객16");
  });

  it("셀 안 줄바꿈은 새 행으로 오인하지 않는다", () => {
    const text = [
      "날짜\t업체\t고객명\t품목\t비고",
      '2026-06-01\t테스트업체\t고객1\t"침대\n매트리스"\t정상',
      "\t테스트업체\t고객2\t의자\t정상",
    ].join("\n");

    const parsed = parsePastedTableText(text);

    expect(parsed).toHaveLength(3);
    expect(parsed[1][3]).toBe("침대\n매트리스");
    expect(parsed[2][2]).toBe("고객2");
  });
});

describe("isSkippablePasteRow", () => {
  it("고객명만 있는 실제 배송 행은 누락하지 않는다", () => {
    expect(isSkippablePasteRow(["홍길동"])).toBe(false);
  });

  it("합계 같은 요약 행만 제외한다", () => {
    expect(isSkippablePasteRow(["합계", "160000"])).toBe(true);
    expect(isSkippablePasteRow(["----------"])).toBe(true);
  });
});