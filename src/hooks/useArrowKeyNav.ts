import { useEffect, RefObject } from "react";

/**
 * 방향키로 폼 요소 간 포커스 이동.
 * - ArrowUp/Down: 위/아래 행의 같은 X좌표에 가까운 요소
 * - ArrowLeft/Right: 같은 행에서 이전/다음 요소
 * - 텍스트 입력(text/textarea/number/email/tel/password/url/search/날짜)에서
 *   Left/Right 는 캐럿이 양 끝일 때만 이동 (그 외엔 기본 캐럿 이동 유지)
 * - IME 조합 중(isComposing)에는 동작 안 함
 * - meta/ctrl/alt 와 함께 누른 경우는 무시 (단축키 보호)
 */
const FOCUSABLE_SEL = [
  "input:not([type=hidden]):not([disabled]):not([readonly])",
  "select:not([disabled])",
  "textarea:not([disabled]):not([readonly])",
  "button:not([disabled])",
  "[role=combobox]:not([disabled])",
  "[role=button]:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const TEXTY = new Set([
  "text", "search", "url", "tel", "email", "password",
  "number", "date", "month", "time", "datetime-local",
]);

function isTextyInput(el: Element): boolean {
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const t = ((el as HTMLInputElement).type || "text").toLowerCase();
  return TEXTY.has(t);
}

function caretAtStart(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  try {
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    return s === 0 && e === 0;
  } catch { return true; }
}
function caretAtEnd(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  try {
    const len = (el.value ?? "").length;
    const s = el.selectionStart ?? len;
    const e = el.selectionEnd ?? len;
    return s === len && e === len;
  } catch { return true; }
}

function visibleRect(el: Element): DOMRect | null {
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const style = window.getComputedStyle(el as HTMLElement);
  if (style.visibility === "hidden" || style.display === "none") return null;
  return r;
}

export function useArrowKeyNav(
  ref: RefObject<HTMLElement | null>,
  opts?: { disabled?: boolean },
) {
  useEffect(() => {
    if (opts?.disabled) return;
    const root = ref.current;
    if (!root) return;

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e as any).isComposing) return;
      const key = e.key;
      if (key !== "ArrowUp" && key !== "ArrowDown" &&
          key !== "ArrowLeft" && key !== "ArrowRight") return;

      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) return;

      // 텍스트 입력: Left/Right 은 캐럿이 끝일 때만 이동
      if (isTextyInput(active)) {
        const inp = active as HTMLInputElement | HTMLTextAreaElement;
        if (key === "ArrowLeft" && !caretAtStart(inp)) return;
        if (key === "ArrowRight" && !caretAtEnd(inp)) return;
        // textarea 의 Up/Down 은 줄바꿈 이동 우선
        if (active.tagName === "TEXTAREA" && (key === "ArrowUp" || key === "ArrowDown")) {
          const ta = active as HTMLTextAreaElement;
          if ((ta.value ?? "").includes("\n")) return;
        }
      }
      // <select> 의 Up/Down 은 옵션 변경이라 그대로 둠
      if (active.tagName === "SELECT" && (key === "ArrowUp" || key === "ArrowDown")) return;
      // role=combobox (열려 있으면 내부 옵션 탐색)
      if (active.getAttribute("aria-expanded") === "true") return;

      const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SEL))
        .filter((el) => visibleRect(el));
      if (all.length === 0) return;

      const curRect = active.getBoundingClientRect();
      const cx = curRect.left + curRect.width / 2;
      const cy = curRect.top + curRect.height / 2;

      type Cand = { el: HTMLElement; dx: number; dy: number; score: number };
      const cands: Cand[] = [];
      for (const el of all) {
        if (el === active) continue;
        const r = el.getBoundingClientRect();
        const ex = r.left + r.width / 2;
        const ey = r.top + r.height / 2;
        const dx = ex - cx;
        const dy = ey - cy;
        cands.push({ el, dx, dy, score: 0 });
      }

      const sameRow = (dy: number) => Math.abs(dy) < 16;
      let target: HTMLElement | null = null;

      if (key === "ArrowRight" || key === "ArrowLeft") {
        const dir = key === "ArrowRight" ? 1 : -1;
        // 같은 행에서 dx 부호가 dir 과 같은 가장 가까운 요소
        const inRow = cands
          .filter((c) => sameRow(c.dy) && Math.sign(c.dx) === dir)
          .sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx));
        if (inRow.length > 0) target = inRow[0].el;
        else {
          // 같은 행에 없으면 다음/이전 줄 끝/처음으로
          const rows = cands
            .filter((c) => (dir > 0 ? c.dy > 4 : c.dy < -4))
            .sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy) || (dir > 0 ? a.dx - b.dx : b.dx - a.dx));
          if (rows.length > 0) target = rows[0].el;
        }
      } else {
        const dir = key === "ArrowDown" ? 1 : -1;
        // 다른 행 중 같은 X에 가까운 요소
        const cross = cands
          .filter((c) => (dir > 0 ? c.dy > 4 : c.dy < -4))
          .map((c) => ({ ...c, score: Math.abs(c.dx) * 1.5 + Math.abs(c.dy) }))
          .sort((a, b) => a.score - b.score);
        if (cross.length > 0) target = cross[0].el;
      }

      if (!target) return;
      e.preventDefault();
      target.focus();
      // 텍스트 입력은 전체 선택 (Excel 식 셀 이동 UX)
      if (target.tagName === "INPUT") {
        const inp = target as HTMLInputElement;
        const t = (inp.type || "text").toLowerCase();
        if (TEXTY.has(t)) {
          try { inp.select(); } catch { /* noop */ }
        }
      } else if (target.tagName === "TEXTAREA") {
        try { (target as HTMLTextAreaElement).select(); } catch { /* noop */ }
      }
      try { target.scrollIntoView?.({ block: "nearest", inline: "nearest" }); } catch { /* noop */ }
    };

    root.addEventListener("keydown", handler);
    return () => root.removeEventListener("keydown", handler);
  }, [ref, opts?.disabled]);
}