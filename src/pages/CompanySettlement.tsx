import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { fmt } from "@/lib/format";
import { matchesCompany } from "@/lib/companyMatch";
import { getCompanyFacingName, isMissingCompanyAlias } from "@/lib/leaderResolver";

type Period = "all" | "first" | "second" | "month";

// 업체정산 목록 컬럼 정의 — 헤더/바디가 100% 동일하게 공유하는 단일 정의
const COMPANY_COLUMNS: Array<{
  key: string;
  label: string;
  width: number;
  align: "left" | "right" | "center";
  amount?: boolean;
}> = [
  { key: "name",     label: "업체명",       width: 160, align: "left" },
  { key: "count",    label: "건수",         width: 80,  align: "center" },
  { key: "total",    label: "배송비합계",   width: 140, align: "right", amount: true },
  { key: "paid",     label: "결제완료금액", width: 150, align: "right", amount: true },
  { key: "unpaid",   label: "미결제금액",   width: 150, align: "right", amount: true },
  { key: "cod",      label: "착불합계",     width: 130, align: "right", amount: true },
  { key: "carry",    label: "이월착불금",   width: 140, align: "right", amount: true },
  { key: "net",      label: "실청구액",     width: 140, align: "right", amount: true },
  { key: "status",   label: "결제상태",     width: 120, align: "center" },
  { key: "detail",   label: "상세보기",     width: 100, align: "center" },
];
const COMPANY_TOTAL_WIDTH = COMPANY_COLUMNS.reduce((s, c) => s + c.width, 0);

const alignClass = (a: "left" | "right" | "center") =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

const fmtAmount = (n: number) => (n && n !== 0 ? fmt(n) : "-");

const paymentStatus = (paid: number, unpaid: number): string => {
  if (paid > 0 && unpaid > 0) return "혼합";
  if (unpaid > 0) return "미결제";
  if (paid > 0) return "결제완료";
  return "-";
};

export default function CompanySettlement() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [period, setPeriod] = useState<Period>("month");
  const [companies, setCompanies] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [allRows, setAllRows] = useState<any[]>([]);
  const [carryRows, setCarryRows] = useState<any[]>([]);
  const [leaders, setLeaders] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: l }] = await Promise.all([
        supabase.from("companies").select("*").eq("active", true).order("name"),
        supabase.from("team_leaders").select("id,name,aliases,is_rejected,settle_to_id"),
      ]);
      setCompanies(c || []);
      setLeaders(l || []);
    })();
  }, []);

  // 기간 범위 계산
  const range = useMemo(() => {
    if (period === "all") return { start: null as string | null, end: null as string | null };
    const start = month + "-01";
    const next = new Date(month + "-01"); next.setMonth(next.getMonth() + 1);
    const lastDay = new Date(next.getTime() - 86400000).getDate();
    if (period === "first") return { start, end: `${month}-16` }; // 1~15 (exclusive end = 16)
    if (period === "second") {
      const endNext = next.toISOString().slice(0, 10);
      return { start: `${month}-16`, end: endNext };
    }
    return { start, end: next.toISOString().slice(0, 10) };
  }, [month, period]);

  // 기간 내 전체 데이터 로드
  useEffect(() => {
    (async () => {
      let q = supabase.from("deliveries").select("*").order("date");
      if (range.start) q = q.gte("date", range.start);
      if (range.end) q = q.lt("date", range.end);
      const { data } = await q;
      setAllRows(data || []);
    })();
  }, [range.start, range.end]);

  // 이월착불금 = 기간 시작 이전의 미결제 착불 합계
  useEffect(() => {
    if (!range.start) { setCarryRows([]); return; }
    (async () => {
      const { data } = await supabase
        .from("deliveries")
        .select("company_id,company_name,cod_amount,paid,date")
        .lt("date", range.start!)
        .eq("paid", false);
      setCarryRows(data || []);
    })();
  }, [range.start]);

  const company = companies.find((c) => c.id === companyId);

  // 업체 제출용 표시: 거부기사는 별칭, 그 외는 정식 팀장명.
  // 정산 계산은 leader_id 기준이므로 이 표시는 화면용일 뿐.
  // 거부기사인데 별칭 미등록이면 "⚠ 별칭없음"으로 표시하고 실제 이름은 노출하지 않음.
  const displayLeaderName = (id: string | null, fallbackName: string | null): string => {
    if (!id) return fallbackName || "-";
    const real = leaders.find((l) => l.id === id);
    if (!real) return fallbackName || "-";
    if (isMissingCompanyAlias(real)) return "⚠ 별칭 미등록";
    return getCompanyFacingName(real);
  };

  // 현재 상세 행 중 별칭 누락 거부기사가 있는지
  const missingAliasLeaders = useMemo(() => {
    if (!company) return [] as { id: string; name: string }[];
    const idSet = new Set<string>();
    for (const r of detailRowsRaw()) {
      [r.leader1_id, r.leader2_id, r.leader3_id].forEach((id) => id && idSet.add(id));
    }
    const out: { id: string; name: string }[] = [];
    idSet.forEach((id) => {
      const l = leaders.find((x) => x.id === id);
      if (l && isMissingCompanyAlias(l)) out.push({ id: l.id, name: l.name });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, allRows, leaders]);

  function detailRowsRaw() {
    return company ? allRows.filter((r) => matchesCompany(r, company)) : [];
  }

  // 업체별 요약 계산
  const summarize = (companyRows: any[], carryForCompany: any[]) => {
    let total = 0, paid = 0, unpaid = 0, cod = 0;
    companyRows.forEach((r) => {
      const delivery = Number(r.metro_fee) + Number(r.regional_fee) + Number(r.note_amount);
      total += delivery;
      if (r.paid) paid += delivery; else unpaid += delivery;
      cod += Number(r.cod_amount);
    });
    const carry = carryForCompany.reduce((s, r) => s + Number(r.cod_amount), 0);
    const rawNet = unpaid - cod - carry;
    const net = Math.max(0, rawNet);
    const newCarry = rawNet < 0 ? -rawNet : 0;
    return { count: companyRows.length, total, paid, unpaid, cod, carry, net, newCarry };
  };

  // 정산주기에 따라 업체 표시 필터
  // - 월전체/전체: 모든 업체 표시 (선택 업체의 월 전체 배송내역 = 1~15일 + 16~말일 합산)
  // - 1~15일 / 16~말일: 보름(biweekly) 주기 업체만 표시 (한달 주기는 월전체로만 정산)
  const visibleCompanies = useMemo(() => {
    return companies.filter((c) => {
      const cyc = c.settlement_cycle || "biweekly";
      if (period === "all" || period === "month") return true;
      return cyc === "biweekly";
    });
  }, [companies, period]);

  const companySummaries = useMemo(() => {
    return visibleCompanies.map((c) => {
      const rs = allRows.filter((r) => matchesCompany(r, c));
      const cr = carryRows.filter((r) => matchesCompany(r, c));
      return { company: c, ...summarize(rs, cr) };
    });
  }, [visibleCompanies, allRows, carryRows]);

  const detailRows = useMemo(
    () => (company ? allRows.filter((r) => matchesCompany(r, company)) : []),
    [company, allRows]
  );
  const detailSummary = useMemo(() => {
    if (!company) return null;
    const cr = carryRows.filter((r) => matchesCompany(r, company));
    return summarize(detailRows, cr);
  }, [company, detailRows, carryRows]);

  const periodLabel =
    period === "all" ? "전체 기간" :
    period === "first" ? `${month} 1~15일` :
    period === "second" ? `${month} 16~말일` :
    `${month} 월전체`;

  // 상단 요약바 (마스터 목록 화면에서만 표시): 현재 기간 기준 전체 합계
  const topSummary = useMemo(() => {
    const totalCompanies = visibleCompanies.length;
    const deliveringCompanyIds = new Set<string>();
    let totalDeliveries = 0, totalCod = 0, totalFee = 0;
    allRows.forEach((r: any) => {
      const matched = visibleCompanies.find((c) => matchesCompany(r, c));
      if (!matched) return;
      totalDeliveries += 1;
      totalCod += Number(r.cod_amount) || 0;
      totalFee += (Number(r.metro_fee) || 0) + (Number(r.note_amount) || 0) + (Number(r.regional_fee) || 0);
      deliveringCompanyIds.add(matched.id);
    });
    return {
      totalCompanies,
      deliveringCompanies: deliveringCompanyIds.size,
      totalDeliveries,
      totalCod,
      totalFee,
    };
  }, [visibleCompanies, allRows]);

  // 컬럼 위치 검증: 헤더 컬럼 수와 데이터 셀 수가 일치하는지 + 순서가 정의와 일치하는지
  const [colAlignError, setColAlignError] = useState<string | null>(null);
  useEffect(() => {
    if (companyId) { setColAlignError(null); return; }
    // requestAnimationFrame 으로 DOM 렌더 후 검사
    const id = requestAnimationFrame(() => {
      const table = document.querySelector<HTMLTableElement>("[data-testid='company-summary-table']");
      if (!table) { setColAlignError(null); return; }
      const headCells = table.querySelectorAll("thead tr th");
      const bodyRows = table.querySelectorAll("tbody tr");
      const expected = COMPANY_COLUMNS.length;
      if (headCells.length !== expected) {
        setColAlignError(`업체정산 목록의 헤더와 데이터 컬럼 위치가 일치하지 않습니다. (헤더 ${headCells.length} / 정의 ${expected})`);
        return;
      }
      for (let i = 0; i < bodyRows.length; i++) {
        const cells = bodyRows[i].querySelectorAll("td");
        // colSpan 안내 행은 1개일 수 있으므로 제외
        if (cells.length === 1 && (cells[0] as HTMLTableCellElement).colSpan === expected) continue;
        if (cells.length !== expected) {
          setColAlignError(`업체정산 목록의 헤더와 데이터 컬럼 위치가 일치하지 않습니다. (행 ${i + 1}: ${cells.length} / ${expected})`);
          return;
        }
      }
      setColAlignError(null);
    });
    return () => cancelAnimationFrame(id);
  }, [companyId, companySummaries]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {companyId && (
          <Button variant="outline" size="sm" onClick={() => setCompanyId("")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 전체 업체 목록
          </Button>
        )}
        <h1 className="text-2xl font-bold flex-1">업체정산</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          disabled={period === "all"}
          className="border rounded px-3 py-2"
        />
        <div className="flex gap-1">
          {([
            ["all", "전체"],
            ["first", "1~15일"],
            ["second", "16~말일"],
            ["month", "월전체"],
          ] as [Period, string][]).map(([p, label]) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "outline"}
              onClick={() => setPeriod(p)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {!companyId && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard
            label="총업체수"
            value={`${topSummary.totalCompanies} / ${topSummary.deliveringCompanies}`}
            sub="활성업체 / 배송업체"
          />
          <SummaryCard label="총배송건수" value={topSummary.totalDeliveries.toLocaleString()} />
          <SummaryCard label="총착불금액" value={fmt(topSummary.totalCod)} accent />
          <SummaryCard label="총배송비" value={fmt(topSummary.totalFee)} bold />
        </div>
      )}

      {!companyId && (
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-2">{periodLabel} 기준 · 업체명 클릭 시 상세보기</div>
          {colAlignError && (
            <div className="mb-2 p-2 rounded border border-destructive bg-destructive/10 text-sm text-destructive">
              {colAlignError}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table
              data-testid="company-summary-table"
              className="text-sm num table-fixed"
              style={{ width: COMPANY_TOTAL_WIDTH, minWidth: COMPANY_TOTAL_WIDTH }}
            >
              <colgroup>
                {COMPANY_COLUMNS.map((c) => (
                  <col key={c.key} style={{ width: c.width }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  {COMPANY_COLUMNS.map((c) => (
                    <TableHead
                      key={c.key}
                      className={`${alignClass(c.align)} ${c.amount ? "bg-muted/40" : ""}`}
                    >
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {companySummaries.map((s) => {
                  const status = paymentStatus(s.paid, s.unpaid);
                  const cells: Record<string, React.ReactNode> = {
                    name: (
                      <button
                        className="text-primary hover:underline font-medium text-left truncate"
                        onClick={() => setCompanyId(s.company.id)}
                      >
                        {s.company.name}
                      </button>
                    ),
                    count: s.count || "-",
                    total: fmtAmount(s.total),
                    paid: fmtAmount(s.paid),
                    unpaid: fmtAmount(s.unpaid),
                    cod: fmtAmount(s.cod),
                    carry: fmtAmount(s.carry),
                    net: <span className="font-semibold">{fmtAmount(s.net)}</span>,
                    status: (
                      <span
                        className={
                          status === "결제완료"
                            ? "text-emerald-600 font-medium"
                            : status === "미결제"
                            ? "text-destructive font-medium"
                            : status === "혼합"
                            ? "text-amber-600 font-medium"
                            : ""
                        }
                      >
                        {status}
                      </span>
                    ),
                    detail: (
                      <Button size="sm" variant="outline" onClick={() => setCompanyId(s.company.id)}>
                        상세
                      </Button>
                    ),
                  };
                  return (
                    <TableRow key={s.company.id} className="hover:bg-muted/50">
                      {COMPANY_COLUMNS.map((c) => (
                        <TableCell key={c.key} className={`${alignClass(c.align)} tabular-nums truncate`}>
                          {cells[c.key]}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                {companySummaries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COMPANY_COLUMNS.length} className="text-center text-muted-foreground py-6">
                      업체 없음
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {company && detailSummary && (
        <Card className="p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <h2 className="font-bold text-lg">{company.name}</h2>
            <span className="text-sm text-muted-foreground">{periodLabel}</span>
          </div>
          {missingAliasLeaders.length > 0 && (
            <div className="mb-3 p-3 rounded border border-destructive/50 bg-destructive/10 text-sm">
              <div className="font-semibold text-destructive mb-1">
                ⚠ 거부기사 표시용 별칭이 없습니다 ({missingAliasLeaders.length}명)
              </div>
              <div className="text-xs text-muted-foreground">
                팀장관리에서 별칭을 입력해주세요. 별칭이 없으면 업체 제출용 정산서 저장이 차단됩니다.
              </div>
              <div className="mt-1 text-xs">
                대상: {missingAliasLeaders.map((l) => l.name).join(", ")}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4 num">
            <Stat label="배송비합계" value={detailSummary.total} />
            <Stat label="결제완료금액" value={detailSummary.paid} />
            <Stat label="미결제금액" value={detailSummary.unpaid} />
            <Stat label="착불합계" value={detailSummary.cod} />
            <Stat label="이월착불금" value={detailSummary.carry} />
            <Stat label="실청구액" value={detailSummary.net} highlight />
            {detailSummary.newCarry > 0 && (
              <Stat label="새이월착불금" value={detailSummary.newCarry} />
            )}
            {company.issues_invoice && (
              <Stat label="부가세포함 청구금액" value={detailSummary.net + Math.round(detailSummary.net * 0.1)} />
            )}
          </div>
          {company.issues_invoice && (
            <div className="text-xs text-muted-foreground mb-3">
              계산서 발행 업체 · 부가세 (10%) {fmt(Math.round(detailSummary.net * 0.1))}
            </div>
          )}
          <Table className="text-xs num">
            <TableHeader>
              <TableRow>
                <TableHead>날짜</TableHead>
                <TableHead>업체</TableHead>
                <TableHead>팀장1</TableHead>
                <TableHead>팀장2</TableHead>
                <TableHead>고객명</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>비고</TableHead>
                <TableHead className="text-right">배송비</TableHead>
                <TableHead>결제유무</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detailRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.date}</TableCell>
                  <TableCell>{r.company_name}</TableCell>
                  <TableCell>{displayLeaderName(r.leader1_id, r.leader1_name)}</TableCell>
                  <TableCell>{displayLeaderName(r.leader2_id, r.leader2_name)}</TableCell>
                  <TableCell>{r.customer_name || "-"}</TableCell>
                  <TableCell className="align-top min-w-[160px] max-w-[320px] whitespace-pre-wrap break-words">{r.item || "-"}</TableCell>
                  <TableCell className="align-top max-w-[240px] whitespace-pre-wrap break-words">{r.note || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee))}</TableCell>
                  <TableCell>{r.paid ? "결제완료" : "미결제"}</TableCell>
                </TableRow>
              ))}
              {detailRows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">데이터 없음</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-4">
            <Button variant="outline" onClick={() => setCompanyId("")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> 전체 업체 목록으로 돌아가기
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-3 rounded border ${highlight ? "bg-primary/10 border-primary" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{fmt(value)}</div>
    </div>
  );
}

function SummaryCard({
  label, value, sub, accent, bold,
}: { label: string; value: string; sub?: string; accent?: boolean; bold?: boolean }) {
  return (
    <div className="p-4 rounded-lg border border-sky-200 bg-sky-50">
      <div className="text-xs text-sky-900/70">{label}</div>
      <div
        className={`mt-1 num ${bold ? "text-2xl font-extrabold" : "text-2xl font-bold"} ${
          accent ? "text-orange-600" : "text-sky-900"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-sky-900/60 mt-0.5">{sub}</div>}
    </div>
  );
}
