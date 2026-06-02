import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmt } from "@/lib/format";
import { loadCompanySettings } from "@/lib/companySettings";
import {
  PERIOD_LABEL,
  type DeductionContext,
  type PeriodKey,
  type StmtCommonDeduction,
  type StmtCommonOverride,
  type StmtCompany,
  type StmtDelivery,
  type StmtLeader,
  type StmtPeriodDeduction,
} from "@/lib/statementData";
import {
  backupJson,
  companiesCsv,
  downloadText,
  leadersCsv,
  runVerify,
  verifyResultCsv,
  displayCustomerName,
  type VerifyResult,
} from "@/lib/verifyChecks";
import { getVerifyRange, normalizeMonthInput } from "@/lib/verifyRange";
import { getCurrentHalf } from "@/lib/autoPeriod";
import {
  isInEffectivePeriod,
  settleOverridePrefix,
  withEffectiveDate,
} from "@/lib/missingOverride";
import { toast } from "@/hooks/use-toast";

export default function Verify() {
  const { user } = useAuth();
  const uid = user?.id;
  const settings = useMemo(() => (uid ? loadCompanySettings(uid) : null), [uid]);

  const initial = useMemo(() => {
    const { month, half } = getCurrentHalf();
    return { month, period: half as PeriodKey };
  }, []);
  const [month, setMonthRaw] = useState<string>(initial.month);
  const setMonth = (v: string) => {
    const n = normalizeMonthInput(v);
    setMonthRaw(n ?? v);
  };
  const [period, setPeriod] = useState<PeriodKey>(initial.period);

  const [companies, setCompanies] = useState<StmtCompany[]>([]);
  const [leaders, setLeaders] = useState<StmtLeader[]>([]);
  const [deliveries, setDeliveries] = useState<StmtDelivery[]>([]);
  const [commonDeductions, setCommonDeductions] = useState<StmtCommonDeduction[]>([]);
  const [commonOverrides, setCommonOverrides] = useState<StmtCommonOverride[]>([]);
  const [periodDeductions, setPeriodDeductions] = useState<StmtPeriodDeduction[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function loadData() {
    if (!uid) return;
    setLoading(true);
    try {
      const range = getVerifyRange(month, period);
      if (!range) { setLoading(false); return; }
      const { from, toExclusive, periodKey, commonPeriodKeys: commonKeys } = range;
      const [cs, ls, ds, dsOv, cds, ovs, pds] = await Promise.all([
        supabase.from("companies").select("*").eq("user_id", uid).order("name"),
        supabase.from("team_leaders").select("*").eq("user_id", uid).order("name"),
        supabase.from("deliveries").select("*").eq("user_id", uid).gte("date", from).lt("date", toExclusive),
        // 누락분 정산 반영월 override 가 이 달을 가리키는 배송기록 추가 수집
        supabase.from("deliveries").select("*").eq("user_id", uid)
          .ilike("missing_reason", `${settleOverridePrefix(month)}%`),
        supabase.from("common_deductions").select("id,label,amount,active").eq("user_id", uid).order("sort_order"),
        supabase.from("leader_common_overrides").select("leader_id,common_deduction_id,period_key,amount").eq("user_id", uid).in("period_key", commonKeys),
        supabase.from("leader_period_deductions").select("leader_id,period_key,label,amount").eq("user_id", uid).eq("period_key", periodKey),
      ]);
      setCompanies((cs.data ?? []) as unknown as StmtCompany[]);
      setLeaders((ls.data ?? []) as unknown as StmtLeader[]);
      // 머지: 원래 date 가 범위 안인데 override 가 다른 달로 빠진 건은 제외,
      // override 가 이 달로 들어온 건은 추가. dedupe by id. 이후 effective filter 로 정밀하게 거른다.
      const dsList = (ds.data ?? []) as unknown as StmtDelivery[];
      const ovList = (dsOv.data ?? []) as unknown as StmtDelivery[];
      const mergedMap = new Map<string, StmtDelivery>();
      for (const d of dsList) mergedMap.set(d.id, d);
      for (const d of ovList) mergedMap.set(d.id, d);
      const merged = Array.from(mergedMap.values())
        .filter((d) =>
          isInEffectivePeriod(
            d as unknown as { date?: string; missing_reason?: string | null },
            month,
            period,
          ),
        )
        // override 가 있는 행은 effective date 로 치환해서 기존 inPeriod(day) 검사에 통과되도록.
        .map((d) => withEffectiveDate(d) as StmtDelivery);
      setDeliveries(merged);
      setCommonDeductions((cds.data ?? []) as unknown as StmtCommonDeduction[]);
      setCommonOverrides((ovs.data ?? []) as unknown as StmtCommonOverride[]);
      setPeriodDeductions((pds.data ?? []) as unknown as StmtPeriodDeduction[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [uid, month, period]);

  const deductionCtx: DeductionContext = useMemo(() => {
    const range = getVerifyRange(month, period);
    const periodKey = range?.periodKey ?? "all";
    const commonPeriodKeys = range?.commonPeriodKeys ?? [];
    return { commonDeductions, commonOverrides, periodDeductions, periodKey, commonPeriodKeys };
  }, [commonDeductions, commonOverrides, periodDeductions, period, month]);

  const runCheck = () => {
    const r = runVerify({
      deliveries, companies, leaders, period, deductionCtx,
      oeunkyuSpecial: settings?.oeunkyuSpecial ?? true,
    });
    setResult(r);
    toast({
      title: "검산 완료",
      description: `오류 ${r.errorCount}건 / 주의 ${r.warningCount}건`,
    });
  };

  const stamp = `${month}_${period}`;

  const dlBackup = () => {
    const txt = backupJson({
      deliveries, companies, leaders, period, deductionCtx, month,
      oeunkyuSpecial: settings?.oeunkyuSpecial ?? true,
    });
    downloadText(`정산_원본백업_${stamp}.json`, "application/json", txt);
  };
  const dlCompanyCsv = () => {
    if (!result) { toast({ title: "먼저 검산을 실행하세요", variant: "destructive" }); return; }
    downloadText(`업체정산_${stamp}.csv`, "text/csv", companiesCsv(result.companyStmts));
  };
  const dlLeaderCsv = () => {
    if (!result) { toast({ title: "먼저 검산을 실행하세요", variant: "destructive" }); return; }
    downloadText(`팀장정산_${stamp}.csv`, "text/csv", leadersCsv(result.leaderStmts));
  };
  const dlResultCsv = () => {
    if (!result) { toast({ title: "먼저 검산을 실행하세요", variant: "destructive" }); return; }
    downloadText(`검산결과_${stamp}.csv`, "text/csv", verifyResultCsv(result));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">정산 검산/백업</h1>
        <p className="text-sm text-muted-foreground">
          기존 정산 계산은 변경하지 않고, 현재 입력값을 기준으로 검산만 수행합니다.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>월</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label>기간</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="h1">{PERIOD_LABEL.h1}</SelectItem>
                <SelectItem value="h2">{PERIOD_LABEL.h2}</SelectItem>
                <SelectItem value="all">{PERIOD_LABEL.all}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runCheck} disabled={loading}>검산 실행</Button>
          <Button variant="outline" onClick={loadData} disabled={loading}>새로고침</Button>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={dlBackup}>전체 원본 백업 (JSON)</Button>
          <Button variant="secondary" onClick={dlCompanyCsv}>업체별 정산 CSV</Button>
          <Button variant="secondary" onClick={dlLeaderCsv}>팀장별 정산 CSV</Button>
          <Button variant="secondary" onClick={dlResultCsv}>검산결과 CSV</Button>
        </div>
      </Card>

      {result && (
        <>
          <Card className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat label="배송건수" value={fmt(result.deliveryCount)} />
              <Stat label="업체배송총합: 전체 배송 원총합" value={fmt(result.companyDeliveryTotal)} />
              <Stat label="팀장배송총합: 팀장 배분 원총합" value={fmt(result.leaderDeliveryTotal)} />
              <Stat label="총합 차이" value={fmt(result.totalsDiff)} />
              <Stat label="업체표시합계: 재방문 2차 이상 숨김 후 참고값" value={fmt(result.companyDisplayTotal)} />
              <Stat label="착불합계" value={fmt(result.codTotal)} />
              <Stat label="회사공제 합계" value={fmt(result.commonDeductionTotal)} />
              <Stat label="개인공제 합계" value={fmt(result.personalDeductionTotal)} />
              <Stat label="총공제 합계" value={fmt(result.totalDeductionTotal)} />
              <Stat label="팀장 정산금액(부가세 전)" value={fmt(result.leaderPayoutBeforeVat)} />
              <Stat label="부가세" value={fmt(result.vatTotal)} />
              <Stat label="팀장 최종지급액(부가세 포함)" value={fmt(result.leaderPayoutTotal)} />
              <Stat label="숨겨진 재방문 2차+ 건수" value={fmt(result.hiddenRevisitCount)} />
              <Stat
                label="오류 / 주의"
                value={`${result.errorCount} / ${result.warningCount}`}
              />
            </div>
          </Card>

          <Card className="p-4">
            <div className="font-semibold mb-2">이슈 목록 (최대 100건 표시 — 전체는 CSV)</div>
            {result.issues.length === 0 ? (
              <div className="text-sm text-muted-foreground">오류/주의 없음</div>
            ) : (
              <ScrollArea className="h-[420px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-1 px-2">심각도</th>
                      <th className="py-1 px-2">코드</th>
                      <th className="py-1 px-2">날짜</th>
                      <th className="py-1 px-2">업체</th>
                      <th className="py-1 px-2">고객명</th>
                      <th className="py-1 px-2">메시지</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues.slice(0, 100).map((i, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="py-1 px-2">
                          <Badge variant={i.severity === "error" ? "destructive" : "secondary"}>
                            {i.severity === "error" ? "오류" : "주의"}
                          </Badge>
                        </td>
                        <td className="py-1 px-2">{i.code}</td>
                        <td className="py-1 px-2">{i.date ?? ""}</td>
                        <td className="py-1 px-2">{i.company ?? ""}</td>
                        <td className="py-1 px-2">{displayCustomerName(i.customer)}</td>
                        <td className="py-1 px-2">{i.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}