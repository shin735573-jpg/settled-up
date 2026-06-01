import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboLeader = {
  id: string;
  name: string;
  aliases?: string[] | null;
  is_rejected?: boolean | null;
};

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

interface Props {
  leaders: ComboLeader[];
  value: string; // selected leader id ("" = none)
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean; // show "(선택 안 함)" option
}

export function LeaderCombobox({ leaders, value, onChange, placeholder, className, allowEmpty = true }: Props) {
  const selected = leaders.find((l) => l.id === value);
  const [query, setQuery] = useState<string>(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    setQuery(selected?.name ?? "");
  }, [selected?.id]);

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
    if (!q || (selected && norm(selected.name) === q)) return leaders.slice(0, 100);
    const starts: ComboLeader[] = [];
    const includes: ComboLeader[] = [];
    for (const l of leaders) {
      const n = norm(l.name);
      const aliasMatch = (l.aliases ?? []).some((a) => norm(a || "").includes(q));
      if (!n.includes(q) && !aliasMatch) continue;
      (n.startsWith(q) ? starts : includes).push(l);
    }
    return [...starts, ...includes].slice(0, 100);
  }, [leaders, query, selected?.id]);

  useEffect(() => {
    if (hi >= filtered.length) setHi(0);
  }, [filtered.length, hi]);

  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[hi];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = (l: ComboLeader | null) => {
    if (!l) {
      onChange("");
      setQuery("");
    } else {
      onChange(l.id);
      setQuery(l.name);
    }
    setOpen(false);
  };

  // options shown in dropdown (with optional empty row at top)
  const options: Array<ComboLeader | null> = allowEmpty ? [null, ...filtered] : [...filtered];

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setHi(0); }
      else setHi((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setHi(Math.max(0, options.length - 1)); }
      else setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (open && hi >= 0 && hi < options.length) {
        e.preventDefault();
        pick(options[hi]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab") {
      if (open && hi >= 0 && hi < options.length) pick(options[hi]);
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        value={query}
        placeholder={placeholder ?? "팀장명 입력 (부분검색·↑↓ 선택)"}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={(e) => {
          setOpen(true);
          const idx = selected ? options.findIndex((l) => l && l.id === selected.id) : -1;
          setHi(idx >= 0 ? idx : 0);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHi(0);
          const exact = leaders.find((l) => norm(l.name) === norm(e.target.value));
          if (exact) onChange(exact.id);
          else if (value) onChange("");
        }}
        onKeyDown={onKey}
        autoComplete="off"
      />
      {open && options.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
          {options.map((l, i) => (
            <div
              key={l?.id ?? "__none__"}
              ref={(el) => { itemRefs.current[i] = el; }}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => { e.preventDefault(); pick(l); }}
              onMouseEnter={() => setHi(i)}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                i === hi ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                l && value === l.id && "font-semibold",
              )}
            >
              {l === null
                ? <span className="text-muted-foreground">(선택 안 함)</span>
                : <>{l.name}{l.is_rejected ? <span className="text-muted-foreground"> (거부기사·별칭표시)</span> : null}</>}
            </div>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && query && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
          일치하는 팀장 없음
        </div>
      )}
    </div>
  );
}