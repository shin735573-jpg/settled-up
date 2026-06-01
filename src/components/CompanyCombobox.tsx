import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboCompany = { id: string; name: string };

interface Props {
  companies: ComboCompany[];
  value: string; // selected company id
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

// 정규화: 공백 제거 + 소문자
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function CompanyCombobox({ companies, value, onChange, placeholder, className, inputRef }: Props) {
  const selected = companies.find((c) => c.id === value);
  const [query, setQuery] = useState<string>(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  // 외부에서 value가 바뀌면 query 동기화 (다른 곳에서 폼이 채워질 때)
  useEffect(() => {
    setQuery(selected?.name ?? "");
  }, [selected?.id]);

  // 바깥 클릭 닫기
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = norm(query);
    // 선택된 값과 동일한 텍스트면 전체 목록을 보여주어 방향키 탐색 가능
    if (!q || (selected && norm(selected.name) === q)) return companies.slice(0, 50);
    // 시작 일치 우선, 그 다음 포함
    const starts: ComboCompany[] = [];
    const includes: ComboCompany[] = [];
    for (const c of companies) {
      const n = norm(c.name);
      if (!n.includes(q)) continue;
      (n.startsWith(q) ? starts : includes).push(c);
    }
    return [...starts, ...includes].slice(0, 50);
  }, [companies, query, selected?.id]);

  useEffect(() => {
    if (hi >= filtered.length) setHi(0);
  }, [filtered.length, hi]);

  // 하이라이트 항목 자동 스크롤
  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[hi];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = (c: ComboCompany) => {
    onChange(c.id);
    setQuery(c.name);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setHi(0);
      } else {
        setHi((h) => Math.min(filtered.length - 1, h + 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setHi(Math.max(0, filtered.length - 1));
      } else {
        setHi((h) => Math.max(0, h - 1));
      }
    } else if (e.key === "Enter") {
      if (open && filtered[hi]) {
        e.preventDefault();
        pick(filtered[hi]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab") {
      if (open && filtered[hi]) pick(filtered[hi]);
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        value={query}
        placeholder={placeholder ?? "업체명 입력 (부분검색·↑↓ 선택)"}
        onFocus={(e) => {
          setOpen(true);
          const idx = selected ? filtered.findIndex((c) => c.id === selected.id) : -1;
          setHi(idx >= 0 ? idx : 0);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
          // 정확 일치 시 즉시 선택
          const exact = companies.find((c) => norm(c.name) === norm(e.target.value));
          if (exact) onChange(exact.id);
          else if (value) onChange("");
        }}
        onKeyDown={onKey}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div ref={listRef} className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
          {filtered.map((c, i) => (
            <div
              key={c.id}
              ref={(el) => { itemRefs.current[i] = el; }}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setHi(i)}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                i === hi ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                value === c.id && "font-semibold",
              )}
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && query && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
          일치하는 업체 없음
        </div>
      )}
    </div>
  );
}