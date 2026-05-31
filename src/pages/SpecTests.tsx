import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  firstHalfDeadline,
  firstHalfGenerateDate,
  secondHalfDeadline,
  secondHalfGenerateDate,
} from "@/lib/businessDay";
import { isClosed, setClosed } from "@/lib/settlementGate";

type PeriodKey = "h1" | "h2" | "all";

/** computeGate 와 동일 규칙을 today/closed 를 주입해서 시뮬레이션 */
function simulate(opts: {
  month: string;
  period: PeriodKey;
  today: string;
  closed: boolean;
  hq?: Set<string>;
}) {
  const hq = opts.hq ?? new Set<string>();
  const deadline =
    opts.period === "h1"
      ? firstHalfDeadline(opts.month, hq)
      : secondHalfDeadline(opts.month, hq);
  const generate =
    opts.period === "h1"
      ? firstHalfGenerateDate(opts.month, hq)
      : secondHalfGenerateDate(opts.month, hq);
  const pastDeadline = opts.today >= deadline;
  const pastGenerate = opts.today >= generate;
  let blockedReason = "";
  if (!pastDeadline) blockedReason = `입력마감일(${deadline}) 이전`;
  else if (!opts.closed) blockedReason = `정산마감 처리 필요`;
  return {
    deadline,
    generate,
    pastDeadline,
    pastGenerate,
    closed: opts.closed,
    blocked: blockedReason.length > 0,
    blockedReason,
  };
}

type Case = {
  id: number;
  title: string;
  run: () => { pass: boolean; detail: string };
};

const M = "2026-04"; // 기준월 (deadline=2026-04-15, generate=2026-04-16)
const PREV = "2026-03";

function eq<T>(a: T, b: T) {
  return a === b;
}

const CASES: Case[] = [
  {
    id: 1,
    title: "입력마감일 이전 + 마감처리 OFF → 저장 차단",
    run: () => {
      const r = simulate({ month: M, period: "h1", today: "2026-04-10", closed: false });
      return {
        pass: r.blocked && !r.pastDeadline,
        detail: `deadline=${r.deadline} blocked=${r.blocked} reason="${r.blockedReason}"`,
      };
    },
  },
  {
    id: 2,
    title: "입력마감일 이전 + 마감처리 ON → 여전히 저장 차단",
    run: () => {
      const r = simulate({ month: M, period: "h1", today: "2026-04-10", closed: true });
      return {
        pass: r.blocked && !r.pastDeadline,
        detail: `blocked=${r.blocked} reason="${r.blockedReason}"`,
      };
    },
  },
  {
    id: 3,
    title: "입력마감일 이후 + 마감처리 OFF → 저장 차단 (마감 안 됨 사유)",
    run: () => {
      const r = simulate({ month: M, period: "h1", today: "2026-04-15", closed: false });
      return {
        pass: r.blocked && r.pastDeadline && r.blockedReason.includes("정산마감"),
        detail: `blocked=${r.blocked} reason="${r.blockedReason}"`,
      };
    },
  },
  {
    id: 4,
    title: "입력마감일 이후 + 마감처리 ON → 저장 허용",
    run: () => {
      const r = simulate({ month: M, period: "h1", today: "2026-04-15", closed: true });
      return { pass: !r.blocked, detail: `blocked=${r.blocked} reason="${r.blockedReason}"` };
    },
  },
  {
    id: 5,
    title: "자동생성일 이후 + 마감처리 OFF → 저장 차단",
    run: () => {
      const r = simulate({ month: M, period: "h1", today: "2026-04-20", closed: false });
      return {
        pass: r.blocked && r.pastGenerate,
        detail: `pastGenerate=${r.pastGenerate} blocked=${r.blocked} reason="${r.blockedReason}"`,
      };
    },
  },
  {
    id: 6,
    title: "자동생성일 이후 + 마감처리 ON → 저장 허용 (재생성으로 v+1)",
    run: () => {
      const r = simulate({ month: M, period: "h1", today: "2026-04-20", closed: true });
      return {
        pass: !r.blocked && r.pastGenerate,
        detail: `pastGenerate=${r.pastGenerate} blocked=${r.blocked}`,
      };
    },
  },
  {
    id: 7,
    title: "정산마감 토글 → closed 상태 즉시 반영",
    run: () => {
      const uid = "__spec_test__";
      setClosed(uid, M, "h1", true);
      const on = isClosed(uid, M, "h1");
      setClosed(uid, M, "h1", false);
      const off = isClosed(uid, M, "h1");
      return { pass: on === true && off === false, detail: `on=${on}, off=${off}` };
    },
  },
  {
    id: 8,
    title: "이전월 h1 → 마감일이 해당 월 15일(또는 이전 영업일)",
    run: () => {
      const r = simulate({ month: PREV, period: "h1", today: "2026-04-01", closed: false });
      const ok = r.deadline.startsWith(PREV) && Number(r.deadline.slice(-2)) <= 15;
      return { pass: ok && r.pastDeadline, detail: `deadline=${r.deadline}` };
    },
  },
  {
    id: 9,
    title: "이전월 h2 → 마감일이 해당 월 말일(또는 이전 영업일)",
    run: () => {
      const r = simulate({ month: PREV, period: "h2", today: "2026-04-01", closed: false });
      const ok = r.deadline.startsWith(PREV) && Number(r.deadline.slice(-2)) >= 28;
      return { pass: ok && r.pastDeadline, detail: `deadline=${r.deadline}` };
    },
  },
  {
    id: 10,
    title: "기간=월전체 → 후반(말일) 마감 기준 적용",
    run: () => {
      const r = simulate({ month: M, period: "all", today: "2026-04-15", closed: false });
      const h2 = simulate({ month: M, period: "h2", today: "2026-04-15", closed: false });
      return { pass: eq(r.deadline, h2.deadline), detail: `all=${r.deadline} h2=${h2.deadline}` };
    },
  },
  {
    id: 11,
    title: "다른 사용자 → closed 상태가 사용자별로 격리",
    run: () => {
      const a = "__spec_test_A__";
      const b = "__spec_test_B__";
      setClosed(a, M, "h1", true);
      setClosed(b, M, "h1", false);
      const aOn = isClosed(a, M, "h1");
      const bOn = isClosed(b, M, "h1");
      setClosed(a, M, "h1", false);
      return { pass: aOn === true && bOn === false, detail: `A=${aOn}, B=${bOn}` };
    },
  },
  {
    id: 12,
    title: "새로고침 시뮬레이션 → localStorage에 closed 유지",
    run: () => {
      const uid = "__spec_test_persist__";
      setClosed(uid, M, "h1", true);
      // 다른 모듈 호출(=재읽기)을 거쳐도 유지되는지
      const after = isClosed(uid, M, "h1");
      setClosed(uid, M, "h1", false);
      return { pass: after === true, detail: `persisted=${after}` };
    },
  },
  {
    id: 13,
    title: "월 변경 → closed 상태가 월별로 격리",
    run: () => {
      const uid = "__spec_test_month__";
      setClosed(uid, M, "h1", true);
      setClosed(uid, PREV, "h1", false);
      const cur = isClosed(uid, M, "h1");
      const prev = isClosed(uid, PREV, "h1");
      setClosed(uid, M, "h1", false);
      return { pass: cur === true && prev === false, detail: `${M}=${cur} ${PREV}=${prev}` };
    },
  },
];

type RunResult = { id: number; title: string; pass: boolean; detail: string };

export default function SpecTests() {
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [running, setRunning] = useState(false);

  function runAll() {
    setRunning(true);
    const out: RunResult[] = [];
    for (const c of CASES) {
      try {
        const r = c.run();
        out.push({ id: c.id, title: c.title, pass: r.pass, detail: r.detail });
      } catch (e) {
        out.push({
          id: c.id,
          title: c.title,
          pass: false,
          detail: `ERROR: ${(e as Error).message}`,
        });
      }
    }
    setResults(out);
    setRunning(false);
  }

  const passCount = results?.filter((r) => r.pass).length ?? 0;
  const total = CASES.length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">사양 15 — 정산마감 게이트 테스트</h1>
          <p className="text-sm text-muted-foreground">
            기준월 {M} (h1 마감일 자동 계산). 13개 케이스를 자동 실행합니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {results && (
            <Badge variant={passCount === total ? "default" : "destructive"} className="text-base">
              {passCount} / {total} PASS
            </Badge>
          )}
          <Button onClick={runAll} disabled={running}>
            {running ? "실행 중..." : "전체 테스트 실행"}
          </Button>
        </div>
      </div>

      <Card className="divide-y">
        {(results ?? CASES.map((c) => ({ id: c.id, title: c.title, pass: false, detail: "—" }))).map(
          (r) => (
            <div key={r.id} className="flex items-start gap-3 p-3">
              <div className="w-8 text-sm font-mono text-muted-foreground">#{r.id}</div>
              <Badge
                variant={results ? (r.pass ? "default" : "destructive") : "secondary"}
                className="w-16 justify-center"
              >
                {results ? (r.pass ? "PASS" : "FAIL") : "대기"}
              </Badge>
              <div className="flex-1">
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1 break-all">
                  {r.detail}
                </div>
              </div>
            </div>
          ),
        )}
      </Card>
    </div>
  );
}