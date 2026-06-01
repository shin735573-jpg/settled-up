const trimTrailingEmptyCells = (row: string[]) => {
  const next = [...row];
  while (next.length > 1 && (next[next.length - 1] ?? "").trim() === "") next.pop();
  return next;
};

export function parsePastedTableText(raw: string): string[][] {
  const text = String(raw ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const atCellStart = cell.length === 0;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && atCellStart) {
      inQuotes = true;
      continue;
    }
    if (ch === "\t") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.trim());
      rows.push(trimTrailingEmptyCells(row));
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(trimTrailingEmptyCells(row));
  }

  return rows.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
}

const numericLike = (value: string) => /^[-+]?\(?[\d,]+(?:\.\d+)?\)?원?$/.test(value.trim());

export function isSkippablePasteRow(row: string[]): boolean {
  const cells = row.map((c) => String(c ?? "").trim()).filter(Boolean);
  if (cells.length === 0) return true;

  const compactCells = cells.map((c) => c.replace(/\s+/g, "").toLowerCase());
  const joinedCompact = compactCells.join("");
  if (/^[=\-_*·•]+$/.test(joinedCompact)) return true;

  const summaryWords = new Set(["합계", "총계", "소계", "총합", "계", "total", "sum"]);
  if (cells.length <= 2) {
    const hasSummaryWord = compactCells.some((c) => summaryWords.has(c));
    const onlySummaryOrNumber = compactCells.every((c) => summaryWords.has(c) || numericLike(c));
    if (hasSummaryWord && onlySummaryOrNumber) return true;
    if (summaryWords.has(joinedCompact)) return true;
  }

  if (cells.length === 1) {
    return /^(정산완료|입금완료|계좌|은행|연락처|담당자|주의|안내|비고없음)$/i.test(joinedCompact);
  }

  return false;
}