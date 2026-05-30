export const fmt = (n: number | null | undefined) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "-";
  const num = Number(n);
  if (num === 0) return "-";
  return num < 0 ? `(${Math.abs(num).toLocaleString()})` : num.toLocaleString();
};

export const parseNum = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").replace(/\s/g, "").trim();
  if (s === "") return 0;
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};

export const parseDate = (v: unknown): string | null => {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // accept yyyy-mm-dd, yyyy/mm/dd, yyyy.mm.dd, m/d, etc.
  const norm = s.replace(/[./]/g, "-");
  const parts = norm.split("-").map((p) => p.trim()).filter(Boolean);
  let y: number, m: number, d: number;
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      y = +parts[0]; m = +parts[1]; d = +parts[2];
    } else {
      y = new Date().getFullYear(); m = +parts[0]; d = +parts[1];
      if (parts[2].length === 4) { y = +parts[2]; m = +parts[0]; d = +parts[1]; }
    }
  } else if (parts.length === 2) {
    y = new Date().getFullYear(); m = +parts[0]; d = +parts[1];
  } else return null;
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};