import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmt } from "@/lib/format";
import { loadCompanySettings } from "@/lib/companySettings";
import {
  buildCompanyStatements,
  buildLeaderStatements,
  detectSpecialLeaderIds,
  PERIOD_LABEL,
  type PeriodKey,
  type StmtCompany,
  type StmtDelivery,
  type StmtLeader,
} from "@/lib/statementData";

export default function Saves() {
  const { user } = useAuth();
  const uid = user?.id;
  const settings = useMemo(() => (uid ? loadCompanySettings(uid) : null), [uid]);

  const [month, setMonth] = useState<string>(() =>
    settings?.defaultMonth || new Date().toISOString().slice(0, 7),
  );
  const [period, setPeriod] = useState<PeriodKey>("h1");

  const [companies, setCompanies] = useState<StmtCompany[]>([]);
  const [leaders, setLeaders] = useState<StmtLeader[]>([]);
  const [deliveries, setDeliveries] = useState<StmtDelivery[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedLeaderId, setSelectedLeaderId] = useState<string | null>(null);

  async function reload() {
    if (!uid) return;
    setLoading(true);
    try {
      const [y, m] = month.split("-").map(Number);
      const from = `${month}-01`;
      const last = new Date(y, m, 0).getDate();
      const to = `${month}-${String(last).padStart(2, "0")}`;
      const [{ data: cs }, { data: ls }, { data: ds }] = await Promise.all([
        supabase.from("companies").select("*").eq("user_id", uid).order("name"),
        supabase.from("team_leaders").select("*").eq("user_id", uid).order("name"),
        supabase.from("deliveries").select("*").eq("user_id", uid).gte("date", from).lte("date", to),
      ]);
      setCompanies((cs ?? []) as unknown as StmtCompany[]);
      setLeaders((ls ?? []) as unknown as StmtLeader[]);
      setDeliveries((ds ?? []) as unknown as StmtDelivery[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [uid, month]);

  const special = useMemo(() => detectSpecialLeaderIds(leaders), [leaders]);
  const oeunkyuSpecial = settings?.oeunkyuSpecial ?? true;

  const companyStmts = useMemo(
    () => buildCompanyStatements(deliveries, companies, leaders, period),
    [deliveries, companies, leaders, period],
  );
  const leaderStmts = useMemo(
    () => buildLeaderStatements(deliveries, leaders, period, { ...special, oeunkyuSpecial }),
    [deliveries, leaders, period, special, oeunkyuSpecial],
  );

  // 기본 선택 자동 동기화
  useEffect(() => {
    if (!selectedCompanyId && companyStmts[0]) setSelectedCompanyId(companyStmts[0].company.id);
    if (selectedCompanyId && !companyStmts.find((s) => s.company.id === selectedCompanyId))
      setSelectedCompanyId(companyStmts[0]?.company.id ?? null);
  }, [companyStmts, selectedCompanyId]);
  useEffect(() => {
    if (!selectedLeaderId && leaderStmts[0]) setSelectedLeaderId(leaderStmts[0].leader.id);
    if (selectedLeaderId && !leaderStmts.find((s) => s.leader.id === selectedLeaderId))
      setSelectedLeaderId(leaderStmts[0]?.leader.id ?? null);
  }, [leaderStmts, selectedLeaderId]);

  const selectedCompany = companyStmts.find((s) => s.company.id === selectedCompanyId);
  const selectedLeader = leaderStmts.find((s) => s.leader.id === selectedLeaderId);

  const notImpl = () => alert("이 기능은 다음 단계에서 추가됩니다 (PNG 생성 / 저장 / 검사).");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">정산서저장</h1>
          <p className="text-sm text-muted-foreground">
            업체·팀장 정산서를 기간별로 PNG 이미지로 저장합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">정산월</Label>
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">기간</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="h1">1~15일</SelectItem>
                <SelectItem value="h2">16~말일</SelectItem>
                <SelectItem value="all">월전체</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={reload} disabled={loading}>
            새로고침
          </Button>
        </div>
      </div>

      {/* 기본 액션 버튼 */}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Button size="lg" className="h-14" onClick={notImpl}>업체 사진 저장</Button>
          <Button size="lg" className="h-14" onClick={notImpl}>업체 전체 사진 저장</Button>
          <Button size="lg" className="h-14" onClick={notImpl}>팀장 사진 저장</Button>
          <Button size="lg" className="h-14" onClick={notImpl}>팀장 전체 사진 저장</Button>
          <Button size="lg" variant="secondary" className="h-14" onClick={notImpl}>정산서 재생성</Button>
          <Button size="lg" variant="outline" className="h-14" onClick={notImpl}>저장 전 오류 검사</Button>
        </div>
      </Card>

      <Tabs defaultValue="company" className="space-y-3">
        <TabsList>
          <TabsTrigger value="company">업체 정산서 ({companyStmts.length})</TabsTrigger>
          <TabsTrigger value="leader">팀장 정산서 ({leaderStmts.length})</TabsTrigger>
        </TabsList>

        {/* 업체 탭 */}
        <TabsContent value="company">
          <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
            <Card className="p-3">
              <div className="mb-2 text-sm font-semibold">업체 목록</div>
              <ScrollArea className="h-[520px]">
                <div className="space-y-1 pr-2">
                  {companyStmts.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      해당 기간 정산 대상 업체가 없습니다.
                    </p>
                  )}
                  {companyStmts.map((s) => {
                    const active = s.company.id === selectedCompanyId;
                    return (
                      <button
                        key={s.company.id}
                        type="button"
                        onClick={() => setSelectedCompanyId(s.company.id)}
                        className={
                          "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition " +
                          (active
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-muted")
                        }
                      >
                        <span className="truncate font-medium">{s.company.name}</span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {s.rows.length}건
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>

            <Card className="p-4">
              {selectedCompany ? (
                <CompanyPreview data={selectedCompany} />
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  업체를 선택하세요.
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* 팀장 탭 */}
        <TabsContent value="leader">
          <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
            <Card className="p-3">
              <div className="mb-2 text-sm font-semibold">팀장 목록</div>
              <ScrollArea className="h-[520px]">
                <div className="space-y-1 pr-2">
                  {leaderStmts.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      해당 기간 정산 대상 팀장이 없습니다.
                    </p>
                  )}
                  {leaderStmts.map((s) => {
                    const active = s.leader.id === selectedLeaderId;
                    return (
                      <button
                        key={s.leader.id}
                        type="button"
                        onClick={() => setSelectedLeaderId(s.leader.id)}
                        className={
                          "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition " +
                          (active
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-muted")
                        }
                      >
                        <span className="truncate font-medium">{s.leader.name}</span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {s.deliveryCount}건
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </Card>

            <Card className="p-4">
              {selectedLeader ? (
                <LeaderPreview data={selectedLeader} />
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  팀장을 선택하세요.
                </div>
              )}
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        ※ 1단계: 구조 + 기간/대상 선택 + 데이터 집계 완료. 다음 단계에서 정산서 렌더링(PNG 생성)·저장·오류검사가 추가됩니다.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// 미리보기 (간단 요약 + 행 목록) — 실제 PNG 디자인은 STEP 2에서 별도 컴포넌트로 분리
// ───────────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={"rounded-md border p-2 text-center " + (accent ? "border-primary bg-primary/5" : "")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{typeof value === "number" ? fmt(value) : value}</div>
    </div>
  );
}

function CompanyPreview({
  data,
}: {
  data: ReturnType<typeof buildCompanyStatements>[number];
}) {
  const c = data.company;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">{PERIOD_LABEL[data.period]} · 미리보기</div>
          <h2 className="text-xl font-bold">{c.name} 정산서</h2>
        </div>
        <div className="flex gap-1">
          {c.issues_invoice && <Badge>계산서 발행</Badge>}
          <Badge variant="outline">
            {c.settlement_cycle === "monthly" ? "한달 정산" : "보름 정산"}
          </Badge>
        </div>
      </div>
      {data.errors.length > 0 && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {data.errors.map((e, i) => (<div key={i}>• {e}</div>))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="배송비합계" value={data.feeTotal} />
        <Stat label="결제완료" value={data.paidTotal} />
        <Stat label="미결제" value={data.unpaidTotal} />
        <Stat label="착불합계" value={data.codTotal} />
        <Stat label="새이월착불" value={data.carryOutCod} />
        <Stat label="실청구" value={data.realClaim} accent />
        <Stat label="최종청구" value={data.finalClaim} accent />
      </div>
      {c.issues_invoice && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="청구금액" value={data.finalClaim} />
          <Stat label="부가세" value={data.vat} />
          <Stat label="부가세포함" value={data.claimWithVat} accent />
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              {["날짜","업체","팀장1","팀장2","고객명","품목","비고","배송비","결제"].map((h) => (
                <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-2 py-1">{r.date.slice(5)}</td>
                <td className="px-2 py-1">{c.name}</td>
                <td className="px-2 py-1">{r.display_leader1}</td>
                <td className="px-2 py-1">{r.display_leader2}</td>
                <td className="px-2 py-1">{r.customer_name ?? ""}</td>
                <td className="px-2 py-1">{r.item ?? ""}</td>
                <td className="px-2 py-1">{r.note ?? ""}</td>
                <td className="px-2 py-1 text-right">{fmt(r.delivery_fee)}</td>
                <td className="px-2 py-1 text-center">
                  {r.paid ? <Badge variant="secondary" className="text-[10px]">완료</Badge> : "-"}
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-4 text-center text-muted-foreground">데이터 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {c.account_number && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm font-semibold">
          계좌: {c.account_number} · 정산 완료 후 입금자명을 전달 부탁드립니다.
        </div>
      )}
    </div>
  );
}

function LeaderPreview({
  data,
}: {
  data: ReturnType<typeof buildLeaderStatements>[number];
}) {
  const l = data.leader;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">{PERIOD_LABEL[data.period]} · 미리보기</div>
          <h2 className="text-xl font-bold">{l.name} 정산서</h2>
        </div>
        <div className="flex gap-1">
          {l.issues_invoice && <Badge>계산서 발행</Badge>}
          {l.min_guarantee_enabled && <Badge variant="outline">최저보장 {fmt(l.min_guarantee_amount)}</Badge>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="배송건수" value={data.deliveryCount} />
        <Stat label="수도권" value={data.metroSum} />
        <Stat label="비고" value={data.noteSum} />
        <Stat label="지방" value={data.regionalSum} />
        <Stat label="실지급배송비" value={data.realFee} />
        <Stat label="착불합계" value={data.codSum} />
        <Stat label="수수료" value={data.feeTotal} />
        <Stat label="계산후" value={data.afterFee} />
        <Stat label="공제총액" value={data.deductionTotal} />
        <Stat label="실지급액" value={data.payout} accent />
      </div>
      {l.issues_invoice && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="실지급액" value={data.payout} />
          <Stat label="부가세" value={data.vat} />
          <Stat label="부가세포함" value={data.payoutWithVat} accent />
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              {["날짜","업체","실제기사1","실제기사2","정산기사","고객명","배송지","품목","비고","수도권","비고","지방","착불","실지급","분할","2인","수수료","계산후","실지급액","처리"].map((h, i) => (
                <th key={i} className="px-1 py-1 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr
                key={r.delivery.id + "-" + i}
                className={"border-t " + (r.isOeunkyuTransfer ? "bg-yellow-100/60" : "")}
              >
                <td className="px-1 py-1">{r.delivery.date.slice(5)}</td>
                <td className="px-1 py-1">{r.delivery.company_name}</td>
                <td className="px-1 py-1">{r.delivery.leader1_name ?? ""}</td>
                <td className="px-1 py-1">{r.delivery.leader2_name ?? ""}</td>
                <td className="px-1 py-1">{l.name}</td>
                <td className="px-1 py-1">{r.delivery.customer_name ?? ""}</td>
                <td className="px-1 py-1">{r.delivery.region ?? ""}</td>
                <td className="px-1 py-1">{r.delivery.item ?? ""}</td>
                <td className="px-1 py-1">{r.delivery.note ?? ""}</td>
                <td className="px-1 py-1 text-right">{fmt(r.share.metro)}</td>
                <td className="px-1 py-1 text-right">{fmt(r.share.note_amount)}</td>
                <td className="px-1 py-1 text-right">{fmt(r.share.regional)}</td>
                <td className="px-1 py-1 text-right">{fmt(r.share.cod)}</td>
                <td className="px-1 py-1 text-right">{fmt(r.share.metro + r.share.note_amount + r.share.regional)}</td>
                <td className="px-1 py-1">{r.delivery.split_type ?? ""}</td>
                <td className="px-1 py-1 text-center">{r.delivery.two_person ? "✓" : ""}</td>
                <td className="px-1 py-1 text-right">{fmt(r.unitFee)}</td>
                <td className="px-1 py-1 text-right">{fmt(r.unitAfterFee)}</td>
                <td className="px-1 py-1 text-right">{fmt(r.unitPayout)}</td>
                <td className="px-1 py-1 text-[10px]">{r.share.reason ?? ""}</td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr><td colSpan={20} className="px-2 py-4 text-center text-muted-foreground">데이터 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {l.account_number && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm font-semibold">
          계좌: {l.account_number}
        </div>
      )}
    </div>
  );
}