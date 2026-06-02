import { describe, it, expect } from "vitest";
import { keepRevisitPrimaryOnly } from "./revisitDedup";

type Row = {
  id: string;
  revisit_group_id?: string | null;
  revisit_visit_no?: number | null;
  date?: string | null;
};

describe("keepRevisitPrimaryOnly (회귀: 업체 청구는 1건만)", () => {
  it("revisit_group_id 없는 행은 그대로 유지", () => {
    const rows: Row[] = [
      { id: "a", date: "2026-01-01" },
      { id: "b", date: "2026-01-02" },
    ];
    expect(keepRevisitPrimaryOnly(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("같은 그룹 2차/3차는 제외, 1차만 남는다", () => {
    const rows: Row[] = [
      { id: "v1", revisit_group_id: "g1", revisit_visit_no: 1, date: "2026-01-01" },
      { id: "v2", revisit_group_id: "g1", revisit_visit_no: 2, date: "2026-01-05" },
      { id: "v3", revisit_group_id: "g1", revisit_visit_no: 3, date: "2026-01-10" },
    ];
    const out = keepRevisitPrimaryOnly(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("v1");
  });

  it("2차가 먼저 들어와도 1차(낮은 visit_no)가 선택됨", () => {
    const rows: Row[] = [
      { id: "v2", revisit_group_id: "g1", revisit_visit_no: 2, date: "2026-01-05" },
      { id: "v1", revisit_group_id: "g1", revisit_visit_no: 1, date: "2026-01-01" },
    ];
    const out = keepRevisitPrimaryOnly(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("v1");
  });

  it("visit_no가 같으면 더 이른 날짜를 1차로 선택", () => {
    const rows: Row[] = [
      { id: "later", revisit_group_id: "g1", revisit_visit_no: 1, date: "2026-02-10" },
      { id: "earlier", revisit_group_id: "g1", revisit_visit_no: 1, date: "2026-01-01" },
    ];
    const out = keepRevisitPrimaryOnly(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("earlier");
  });

  it("여러 그룹 + 일반 행 혼합 시 그룹당 1건 + 일반행은 모두 유지", () => {
    const rows: Row[] = [
      { id: "n1", date: "2026-01-01" },
      { id: "g1-v1", revisit_group_id: "g1", revisit_visit_no: 1, date: "2026-01-02" },
      { id: "g1-v2", revisit_group_id: "g1", revisit_visit_no: 2, date: "2026-01-09" },
      { id: "g2-v1", revisit_group_id: "g2", revisit_visit_no: 1, date: "2026-01-03" },
      { id: "g2-v2", revisit_group_id: "g2", revisit_visit_no: 2, date: "2026-01-08" },
      { id: "g2-v3", revisit_group_id: "g2", revisit_visit_no: 3, date: "2026-01-15" },
      { id: "n2", date: "2026-01-04" },
    ];
    const out = keepRevisitPrimaryOnly(rows);
    expect(out.map((r) => r.id).sort()).toEqual(
      ["g1-v1", "g2-v1", "n1", "n2"].sort()
    );
  });

  it("팀장 내역 시뮬레이션: dedup을 적용하지 않으면 차수별 모두 표시됨", () => {
    // 팀장 내역은 keepRevisitPrimaryOnly를 사용하지 않는다.
    // 원본 배열이 차수별 행을 모두 가지고 있음을 보장(회귀 가드).
    const rows: Row[] = [
      { id: "v1", revisit_group_id: "g1", revisit_visit_no: 1, date: "2026-01-01" },
      { id: "v2", revisit_group_id: "g1", revisit_visit_no: 2, date: "2026-01-05" },
      { id: "v3", revisit_group_id: "g1", revisit_visit_no: 3, date: "2026-01-10" },
    ];
    // 팀장 측은 dedup 미적용 → 3건 모두 유지
    expect(rows).toHaveLength(3);
    // 업체 측은 dedup 적용 → 1건
    expect(keepRevisitPrimaryOnly(rows)).toHaveLength(1);
  });
});
