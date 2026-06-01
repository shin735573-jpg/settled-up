import { Input } from "@/components/ui/input";
import { parseNum } from "@/lib/format";
import { useEffect, useState, forwardRef } from "react";

type Props = Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
};

const withCommas = (s: string) => {
  if (s === "" || s === "-") return s;
  const n = parseNum(s);
  return n.toLocaleString();
};

export const AmountTextInput = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, ...rest }, ref) => {
    const [text, setText] = useState<string>(withCommas(value ?? ""));
    const [focused, setFocused] = useState(false);

    useEffect(() => {
      if (!focused) setText(withCommas(value ?? ""));
    }, [value, focused]);

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        value={text}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => {
          setFocused(false);
          setText(withCommas(value ?? ""));
          rest.onBlur?.(e);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || raw === "-") {
            setText(raw);
            onChange(raw);
            return;
          }
          const n = parseNum(raw);
          setText(n.toLocaleString());
          onChange(String(n));
        }}
      />
    );
  },
);
AmountTextInput.displayName = "AmountTextInput";