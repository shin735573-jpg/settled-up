import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useRef } from "react";
import { useArrowKeyNav } from "./useArrowKeyNav";

/**
 * 방향키 셀 이동 케이스별 자동 테스트.
 * jsdom 은 레이아웃을 계산하지 않으므로 getBoundingClientRect 를 직접 stub 한다.
 */

type CellSpec = { x: number; y: number; w?: number; h?: number; tag?: "input" | "button" | "textarea" | "select"; type?: string; value?: string };

function Grid({ cells }: { cells: CellSpec[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useArrowKeyNav(ref);
  return (
    <div ref={ref}>
      {cells.map((c, i) => {
        const common = {
          "data-idx": String(i),
          ref: (el: HTMLElement | null) => {
            if (!el) return;
            const w = c.w ?? 80;
            const h = c.h ?? 30;
            el.getBoundingClientRect = () => ({
              x: c.x, y: c.y, left: c.x, top: c.y,
              right: c.x + w, bottom: c.y + h,
              width: w, height: h, toJSON: () => ({}),
            }) as DOMRect;
          },
        } as any;
        const tag = c.tag ?? "input";
        if (tag === "button") return <button key={i} {...common}>btn{i}</button>;
        if (tag === "textarea") return <textarea key={i} defaultValue={c.value ?? ""} {...common} />;
        if (tag === "select") return (
          <select key={i} {...common}>
            <option value="a">A</option><option value="b">B</option>
          </select>
        );
        return <input key={i} type={c.type ?? "text"} defaultValue={c.value ?? ""} {...common} />;
      })}
    </div>
  );
}

const activeIdx = () =>
  Number((document.activeElement as HTMLElement)?.getAttribute("data-idx") ?? -1);

function press(key: string, opts: KeyboardEventInit = {}) {
  act(() => {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
    document.activeElement?.dispatchEvent(ev);
  });
}

function focusIdx(i: number) {
  const el = document.querySelector<HTMLElement>(`[data-idx="${i}"]`);
  el?.focus();
  // 텍스트 입력은 캐럿을 끝으로
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const len = (el.value ?? "").length;
    try { el.setSelectionRange(len, len); } catch { /* noop */ }
  }
}

/** 2x3 grid (row1: 0,1,2 / row2: 3,4,5) */
const grid2x3: CellSpec[] = [
  { x: 0,  y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 },
  { x: 0,  y: 50 }, { x: 100, y: 50 }, { x: 200, y: 50 },
];

afterEach(() => cleanup());

describe("useArrowKeyNav — 기본 그리드 이동", () => {
  it("→ 같은 행 다음 셀", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(0);
    press("ArrowRight");
    expect(activeIdx()).toBe(1);
  });
  it("← 같은 행 이전 셀", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(2);
    press("ArrowLeft");
    expect(activeIdx()).toBe(1);
  });
  it("↓ 같은 컬럼 아래 행", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(1);
    press("ArrowDown");
    expect(activeIdx()).toBe(4);
  });
  it("↑ 같은 컬럼 위 행", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(5);
    press("ArrowUp");
    expect(activeIdx()).toBe(2);
  });
  it("→ 행 끝에서 다음 줄 처음으로 줄바꿈", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(2);
    press("ArrowRight");
    expect(activeIdx()).toBe(3);
  });
  it("← 행 처음에서 이전 줄 끝으로", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(3);
    press("ArrowLeft");
    expect(activeIdx()).toBe(2);
  });
});

describe("useArrowKeyNav — 입력 타입별 동작", () => {
  it("text 입력: 캐럿이 중간이면 ← 차단(셀 이동 안 함)", () => {
    render(<Grid cells={[{ x: 0, y: 0, value: "abcd" }, { x: 100, y: 0 }]} />);
    focusIdx(0);
    const inp = document.activeElement as HTMLInputElement;
    inp.setSelectionRange(2, 2);
    press("ArrowLeft");
    expect(activeIdx()).toBe(0);
  });
  it("text 입력: 캐럿이 끝이면 → 셀 이동", () => {
    render(<Grid cells={[{ x: 0, y: 0, value: "abcd" }, { x: 100, y: 0 }]} />);
    focusIdx(0); // setSelectionRange to end
    press("ArrowRight");
    expect(activeIdx()).toBe(1);
  });
  it("number 입력: ↑/↓ 셀 이동 (텍스트 캐럿 무시)", () => {
    render(<Grid cells={[
      { x: 0, y: 0, type: "number", value: "5" },
      { x: 0, y: 50, type: "number" },
    ]} />);
    focusIdx(0);
    press("ArrowDown");
    expect(activeIdx()).toBe(1);
  });
  it("date 입력: → 캐럿이 끝이면 이동", () => {
    render(<Grid cells={[
      { x: 0, y: 0, type: "date", value: "2026-05-01" },
      { x: 100, y: 0, type: "date" },
    ]} />);
    focusIdx(0);
    press("ArrowRight");
    expect(activeIdx()).toBe(1);
  });
  it("textarea: 줄바꿈 있으면 ↓ 이동 안 함", () => {
    render(<Grid cells={[
      { x: 0, y: 0, tag: "textarea", value: "line1\nline2" },
      { x: 0, y: 50 },
    ]} />);
    focusIdx(0);
    press("ArrowDown");
    expect(activeIdx()).toBe(0);
  });
  it("textarea: 줄바꿈 없으면 ↓ 셀 이동", () => {
    render(<Grid cells={[
      { x: 0, y: 0, tag: "textarea", value: "oneline" },
      { x: 0, y: 50 },
    ]} />);
    focusIdx(0);
    press("ArrowDown");
    expect(activeIdx()).toBe(1);
  });
  it("select: ↓/↑ 옵션 변경 우선 (셀 이동 안 함)", () => {
    render(<Grid cells={[
      { x: 0, y: 0, tag: "select" },
      { x: 0, y: 50 },
    ]} />);
    focusIdx(0);
    press("ArrowDown");
    expect(activeIdx()).toBe(0);
  });
  it("button: 모든 방향키 이동", () => {
    render(<Grid cells={[
      { x: 0, y: 0, tag: "button" }, { x: 100, y: 0, tag: "button" },
    ]} />);
    focusIdx(0);
    press("ArrowRight");
    expect(activeIdx()).toBe(1);
  });
});

describe("useArrowKeyNav — 보호 동작", () => {
  it("Ctrl+화살표: 동작 안 함", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(0);
    press("ArrowRight", { ctrlKey: true });
    expect(activeIdx()).toBe(0);
  });
  it("Meta+화살표: 동작 안 함", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(0);
    press("ArrowRight", { metaKey: true });
    expect(activeIdx()).toBe(0);
  });
  it("화살표가 아닌 키: 무시", () => {
    render(<Grid cells={grid2x3} />);
    focusIdx(0);
    press("Enter");
    expect(activeIdx()).toBe(0);
  });
  it("aria-expanded=true (열린 콤보박스): 이동 안 함", () => {
    render(<Grid cells={grid2x3} />);
    const el = document.querySelector<HTMLElement>(`[data-idx="0"]`)!;
    el.setAttribute("aria-expanded", "true");
    focusIdx(0);
    press("ArrowDown");
    expect(activeIdx()).toBe(0);
  });
  it("disabled/readonly 요소는 건너뜀", () => {
    render(
      <DisabledMix />,
    );
    focusIdx(0);
    press("ArrowRight");
    // idx 1 은 disabled → idx 2 로 이동
    expect(activeIdx()).toBe(2);
  });
});

function DisabledMix() {
  const ref = useRef<HTMLDivElement>(null);
  useArrowKeyNav(ref);
  const positions = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 },
  ];
  return (
    <div ref={ref}>
      {positions.map((p, i) => (
        <input
          key={i}
          data-idx={String(i)}
          disabled={i === 1}
          ref={(el) => {
            if (!el) return;
            el.getBoundingClientRect = () => ({
              x: p.x, y: p.y, left: p.x, top: p.y,
              right: p.x + 80, bottom: p.y + 30,
              width: 80, height: 30, toJSON: () => ({}),
            }) as DOMRect;
          }}
        />
      ))}
    </div>
  );
}