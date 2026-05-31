import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
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
  type StmtCommonDeduction,
  type StmtCommonOverride,
  type StmtPeriodDeduction,
  type DeductionContext,
} from "@/lib/statementData";
import {
  validateCompanyStatement,
  validateLeaderStatement,
  validateOeunkyuTransferCoverage,
  mergeResults,
  type CheckResult,
} from "@/lib/statementValidation";
import { toast } from "@/hooks/use-toast";
import { exportSingle, exportZip, type ExportTarget } from "@/lib/statementExport";
import { getEntry, keyFor } from "@/lib/statementVersion";

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
  const [commonDeductions, setCommonDeductions] = useState<StmtCommonDeduction[]>([]);
  const [commonOverrides, setCommonOverrides] = useState<StmtCommonOverride[]>([]);
  const [periodDeductions, setPeriodDeductions] = useState<StmtPeriodDeduction[]>([]);
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
      const periodKey = period === "all" ? "all" : `${month}-${period === "h1" ? "first" : "second"}`;
      const commonKeys = period === "all"
        ? ["all"]
        : [`${month}-${period === "h1" ? "first" : "second"}`];
      const [{ data: cs }, { data: ls }, { data: ds }, { data: cds }, { data: ovs }, { data: pds }] = await Promise.all([
        supabase.from("companies").select("*").eq("user_id", uid).order("name"),
        supabase.from("team_leaders").select("*").eq("user_id", uid).order("name"),
        supabase.from("deliveries").select("*").eq("user_id", uid).gte("date", from).lte("date", to),
        supabase.from("common_deductions").select("id,label,amount,active").eq("user_id", uid).order("sort_order"),
        supabase.from("leader_common_overrides").select("leader_id,common_deduction_id,period_key,amount").eq("user_id", uid).in("period_key", commonKeys),
        supabase.from("leader_period_deductions").select("leader_id,period_key,label,amount").eq("user_id", uid).eq("period_key", periodKey),
      ]);
      setCompanies((cs ?? []) as unknown as StmtCompany[]);
      setLeaders((ls ?? []) as unknown as StmtLeader[]);
      setDeliveries((ds ?? []) as unknown as StmtDelivery[]);
      setCommonDeductions((cds ?? []) as unknown as StmtCommonDeduction[]);
      setCommonOverrides((ovs ?? []) as unknown as StmtCommonOverride[]);
      setPeriodDeductions((pds ?? []) as unknown as StmtPeriodDeduction[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [uid, month, period]);

  const special = useMemo(() => detectSpecialLeaderIds(leaders), [leaders]);
  const oeunkyuSpecial = settings?.oeunkyuSpecial ?? true;

  const deductionCtx: DeductionContext = useMemo(() => {
    const periodKey = period === "all" ? "all" : `${month}-${period === "h1" ? "first" : "second"}`;
    const commonPeriodKeys = period === "all"
      ? ["all"]
      : [`${month}-${period === "h1" ? "first" : "second"}`];
    return { commonDeductions, commonOverrides, periodDeductions, periodKey, commonPeriodKeys };
  }, [commonDeductions, commonOverrides, periodDeductions, period, month]);

  const companyStmts = useMemo(
    () => buildCompanyStatements(deliveries, companies, leaders, period),
    [deliveries, companies, leaders, period],
  );
  const leaderStmts = useMemo(
    () => buildLeaderStatements(deliveries, leaders, period, { ...special, oeunkyuSpecial }, deductionCtx),
    [deliveries, leaders, period, special, oeunkyuSpecial, deductionCtx],
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

  // ─── 저장 전 오류 검사 + 후속 저장 액션 ────────────────────
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [pendingSave, setPendingSave] = useState<null | (() => void)>(null);
  const [checkTitle, setCheckTitle] = useState<string>("");

  /**
   * scope:
   *  - "company-one" / "company-all"
   *  - "leader-one"  / "leader-all"
   *  - "both-all"  (재생성 / 저장 전 오류 검사)
   */
  type Scope = "company-one" | "company-all" | "leader-one" | "leader-all" | "both-all";

  function runChecksFor(scope: Scope): CheckResult {
    const results: CheckResult[] = [];
    const targetsC: typeof companyStmts =
      scope === "company-one" && selectedCompany ? [selectedCompany]
      : scope === "company-all" || scope === "both-all" ? companyStmts
      : [];
    const targetsL: typeof leaderStmts =
      scope === "leader-one" && selectedLeader ? [selectedLeader]
      : scope === "leader-all" || scope === "both-all" ? leaderStmts
      : [];

    for (const data of targetsC) results.push(validateCompanyStatement(data));
    for (const data of targetsL) {
      results.push(
        validateLeaderStatement(data, { leaders, ...special, oeunkyuSpecial }),
      );
    }
    // 오은규→오동선 누락 (팀장 검사가 포함된 경우만 1회)
    if (targetsL.length > 0 && special.oeunkyuId && special.odongseonId) {
      const odongseonStmt = leaderStmts.find((s) => s.leader.id === special.odongseonId);
      results.push(
        validateOeunkyuTransferCoverage(
          deliveries,
          odongseonStmt,
          special.oeunkyuId,
          special.odongseonId,
          oeunkyuSpecial,
        ),
      );
    }
    return mergeResults(...results);
  }

  function withValidation(title: string, scope: Scope, save: () => void) {
    const result = runChecksFor(scope);
    setCheckTitle(title);
    setCheckResult(result);
    if (result.ok && result.warnings.length === 0) {
      // 완전 통과 → 즉시 다이얼로그 닫고 실행
      setCheckResult(null);
      save();
      return;
    }
    // 오류 or 경고 → 다이얼로그 표시. setState(fn) 은 updater 로 해석되므로 한 번 더 감싼다.
    setPendingSave(() => (result.ok ? save : null));
  }

  const doSaveStub = (label: string) => () => {
    toast({ title: "저장 단계 준비 중", description: `${label} — 오류 검사 통과. PNG 생성/업로드는 다음 단계에서 활성화됩니다.` });
  };

  const onSaveCompanyOne = () => withValidation(
    `${selectedCompany?.company.name ?? "업체"} 정산서 저장`,
    "company-one",
    doSaveStub(`${selectedCompany?.company.name} 업체 정산서`),
  );
  const onSaveCompanyAll = () => withValidation(
    "업체 전체 정산서 저장", "company-all", doSaveStub("업체 전체"),
  );
  const onSaveLeaderOne = () => withValidation(
    `${selectedLeader?.leader.name ?? "팀장"} 정산서 저장`,
    "leader-one",
    doSaveStub(`${selectedLeader?.leader.name} 팀장 정산서`),
  );
  const onSaveLeaderAll = () => withValidation(
    "팀장 전체 정산서 저장", "leader-all", doSaveStub("팀장 전체"),
  );
  const onRegenerate = () => withValidation(
    "정산서 재생성", "both-all", doSaveStub("재생성"),
  );
  const onCheckOnly = () => {
    const result = runChecksFor("both-all");
    setCheckTitle("저장 전 오류 검사 결과 (업체 + 팀장)");
    setCheckResult(result);
    setPendingSave(null);
  };

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
          <Button size="lg" className="h-14" onClick={onSaveCompanyOne} disabled={!selectedCompany}>업체 사진 저장</Button>
          <Button size="lg" className="h-14" onClick={onSaveCompanyAll} disabled={companyStmts.length === 0}>업체 전체 사진 저장</Button>
          <Button size="lg" className="h-14" onClick={onSaveLeaderOne} disabled={!selectedLeader}>팀장 사진 저장</Button>
          <Button size="lg" className="h-14" onClick={onSaveLeaderAll} disabled={leaderStmts.length === 0}>팀장 전체 사진 저장</Button>
          <Button size="lg" variant="secondary" className="h-14" onClick={onRegenerate}>정산서 재생성</Button>
          <Button size="lg" variant="outline" className="h-14" onClick={onCheckOnly}>저장 전 오류 검사</Button>
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
        ※ 미리보기는 화면용입니다. 저장 시 동일 데이터로 카톡 공유용 PNG가 생성됩니다.
        파일명: 업체_업체명_기간_v1.png · 팀장_팀장명_기간_v1.png (재생성 시 v2, v3로 자동 증가).
      </p>

      <Dialog open={!!checkResult} onOpenChange={(o) => { if (!o) { setCheckResult(null); setPendingSave(null); } }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {checkTitle}
              {checkResult && (
                checkResult.errors.length > 0
                  ? <Badge variant="destructive" className="ml-2">오류 {checkResult.errors.length}</Badge>
                  : checkResult.warnings.length > 0
                  ? <Badge variant="secondary" className="ml-2">경고 {checkResult.warnings.length}</Badge>
                  : <Badge className="ml-2">통과</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {checkResult?.errors.length
                ? "오류가 있어 저장이 차단됩니다. 아래 항목을 수정 후 다시 시도하세요."
                : checkResult?.warnings.length
                ? "경고가 있습니다. 내용을 확인하고 진행 여부를 선택하세요."
                : "이상 없습니다."}
            </DialogDescription>
          </DialogHeader>
          {checkResult && (
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">전체 검사</div>
                <div className="text-base font-bold">{checkResult.findings.length}</div>
              </div>
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
                <div className="text-muted-foreground">오류</div>
                <div className="text-base font-bold text-destructive">{checkResult.errors.length}</div>
              </div>
              <div className="rounded-md border border-yellow-300 bg-yellow-50 p-2 dark:bg-yellow-950/30">
                <div className="text-muted-foreground">경고</div>
                <div className="text-base font-bold text-yellow-700 dark:text-yellow-300">{checkResult.warnings.length}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">정상</div>
                <div className="text-base font-bold">
                  {checkResult.findings.length === 0 ? "OK" : "-"}
                </div>
              </div>
            </div>
          )}
          <ScrollArea className="max-h-[360px] pr-3">
            <ul className="space-y-1 text-sm">
              {checkResult?.findings.map((f, i) => (
                <li
                  key={i}
                  className={
                    "rounded border px-2 py-1 " +
                    (f.severity === "error"
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : "border-yellow-300 bg-yellow-50 text-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-200")
                  }
                >
                  <span className="mr-1 font-semibold">{f.severity === "error" ? "오류" : "경고"}</span>
                  {f.message}
                </li>
              ))}
              {checkResult && checkResult.findings.length === 0 && (
                <li className="text-center text-muted-foreground">검사 완료 — 발견된 항목 없음</li>
              )}
            </ul>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCheckResult(null); setPendingSave(null); }}>
              닫기
            </Button>
            {pendingSave && (
              <Button
                onClick={() => {
                  const fn = pendingSave;
                  setCheckResult(null);
                  setPendingSave(null);
                  fn();
                }}
              >
                경고 확인 후 저장 진행
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        <Stat label="이전이월착불금" value={data.carryInCod} />
        <Stat label="새이월착불금" value={data.carryOutCod} />
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
          계좌: {c.account_number}
          <div className="mt-1 text-xs font-normal text-muted-foreground">
            정산 완료 후 입금자명을 전달 부탁드립니다.
          </div>
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
        <Stat label="수도권배송비" value={data.metroSum} />
        <Stat label="비고금액" value={data.noteSum} />
        <Stat label="지방배송비" value={data.regionalSum} />
        <Stat label="실지급배송비" value={data.realFee} />
        <Stat label="착불합계" value={data.codSum} />
        <Stat label="수수료합계" value={data.feeTotal} />
        <Stat label="계산후 지급금액" value={data.afterFee} />
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
      {data.deductions && (data.deductions.commonLines.length > 0 || data.deductions.personalLines.length > 0) && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs">
          <div className="mb-1 font-semibold">공제 내역</div>
          <ul className="space-y-0.5">
            {data.deductions.commonLines.map((d, i) => (
              <li key={"c"+i} className="flex justify-between">
                <span>공통 · {d.label}{data.deductions!.commonLines.length > 1 ? ` (${d.periodKey})` : ""}</span>
                <span className="font-medium">{fmt(d.amount)}</span>
              </li>
            ))}
            {data.deductions.personalLines.map((d, i) => (
              <li key={"p"+i} className="flex justify-between">
                <span>개별 · {d.label}</span>
                <span className="font-medium">{fmt(d.amount)}</span>
              </li>
            ))}
            <li className="mt-1 flex justify-between border-t pt-1 font-semibold">
              <span>공제총액</span><span>{fmt(data.deductions.total)}</span>
            </li>
          </ul>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              {["날짜","업체","실제기사1","실제기사2","정산기사","고객명","배송지","품목","비고","수도권배송비","비고금액","지방배송비","착불","실지급배송비","분할","2인배송","건별 수수료","건별 계산후 지급액","건별 실지급액","정산처리"].map((h, i) => (
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
                <td className="px-1 py-1 text-[10px]">
                  {r.isOeunkyuTransfer ? "오은규 → 오동선" : (r.share.reason ?? "")}
                </td>
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