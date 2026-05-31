import { Input } from "@/components/ui/input";
import { parseNum } from "@/lib/format";
import { useEffect, useState } from "react";

type Props = {
  value: number | null | undefined;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
};

const format = (n: number) => n.toLocaleString();

export function AmountInput({ value, onChange, className, placeholder, readOnly }: Props) {
  const [text, setText] = useState<string>(format(Number(value || 0)));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(format(Number(value || 0)));
  }, [value, focused]);

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      readOnly={readOnly}
      className={className}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(format(parseNum(text)));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        const n = parseNum(raw);
        // 입력 중에도 천단위 구분 표시
        setText(raw === "" || raw === "-" ? raw : n.toLocaleString());
        onChange(n);
      }}
    />
  );
}