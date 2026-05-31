import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 누락 화면 방지: 방향키 네비게이션이 모든 주요 화면에 적용되었는지 자동 검증.
 * - useArrowKeyNav import
 * - rootRef 또는 recordsRootRef 와 같은 ref 가 루트 div 에 연결됨
 */
const TARGETS = [
  "src/pages/Records.tsx",
  "src/pages/CompanySettlement.tsx",
  "src/pages/LeaderSettlement.tsx",
  "src/pages/Summary.tsx",
  "src/pages/HQSettlement.tsx",
  "src/pages/Settings.tsx",
];

describe("방향키 네비게이션 적용 커버리지", () => {
  for (const rel of TARGETS) {
    it(`${rel} 에 useArrowKeyNav 적용`, () => {
      const full = path.resolve(process.cwd(), rel);
      const src = readFileSync(full, "utf8");
      expect(src).toMatch(/from\s+["']@\/hooks\/useArrowKeyNav["']/);
      expect(src).toMatch(/useArrowKeyNav\s*\(/);
      // ref 가 실제로 컨테이너에 연결되어 있어야 함
      expect(src).toMatch(/ref=\{[A-Za-z_][A-Za-z0-9_]*Ref\}/);
    });
  }
});