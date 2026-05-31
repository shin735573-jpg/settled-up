import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { detectDuplicates, findAliasConflict, findDisplayNameConflict, getDisplayName, resolveLeaderName } from "@/lib/leaderResolver";
import {
  loadCompanySettings, saveCompanySettings, type CompanySettings,
} from "@/lib/companySettings";

type Company = {
  id: string;
  name: string;
  issues_invoice: boolean;
  account_number: string | null;
  settlement_cycle: "biweekly" | "monthly";
  rejected_leader_id: string | null;
  rejected_leader_id_2: string | null;
  rejected_leader_id_3: string | null;
  has_cod: boolean;
  active: boolean;
};
type Leader = {
  id: string;
  name: string;
  region: string | null;
  is_rejected: boolean;
  fee_rate_metro: number;
  fee_rate_regional: number;
  settle_to_id: string | null;
  active: boolean;
  aliases: string[];
  display_suffix: string | null;
  issues_invoice: boolean;
  account_number: string | null;
  settle_status: "included" | "excluded";
  min_guarantee_enabled: boolean;
  min_guarantee_amount: number;
};
type Holiday = { id: string; date: string; scope: string; team_leader_id: string | null };

export default function Settings() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">설정</h1>
      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company">회사 설정</TabsTrigger>
          <TabsTrigger value="companies">업체관리</TabsTrigger>
          <TabsTrigger value="leaders">팀장관리</TabsTrigger>
          <TabsTrigger value="common-deductions">공통공제관리</TabsTrigger>
        </TabsList>
        <TabsContent value="company"><CompanyTab /></TabsContent>
        <TabsContent value="companies"><CompaniesTab /></TabsContent>
        <TabsContent value="leaders"><LeadersTab /></TabsContent>
        <TabsContent value="common-deductions"><CommonDeductionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function CompanyTab() {
  const { user } = useAuth();
  const uid = user?.id ?? "anon";
  const [s, setS] = useState<CompanySettings>(() => loadCompanySettings(uid));
  useEffect(() => { setS(loadCompanySettings(uid)); }, [uid]);

  const update = (patch: Partial<CompanySettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveCompanySettings(uid, next);
  };

  return (
    <Card className="p-6 space-y-5 max-w-2xl">
      <div>
        <h2 className="font-semibold mb-1">회사 설정</h2>
        <p className="text-xs text-muted-foreground">
          저장 즉시 모든 화면(정산서·본사정산·한눈요약 등)에 반영됩니다.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm">회사명</Label>
          <Input
            className="mt-1"
            value={s.companyName}
            onChange={(e) => update({ companyName: e.target.value })}
            placeholder="예: 삼호물류"
          />
        </div>
        <div>
          <Label className="text-sm">기본 정산월</Label>
          <Input
            type="month"
            className="mt-1"
            value={s.defaultMonth}
            onChange={(e) => update({ defaultMonth: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            적재비 일자 입력 시 이 정산월을 기준으로 월·일이 자동 변환됩니다.
          </p>
        </div>
        <div className="md:col-span-2">
          <Label className="text-sm">기본 계좌번호</Label>
          <Input
            className="mt-1"
            value={s.defaultAccount}
            onChange={(e) => update({ defaultAccount: e.target.value })}
            placeholder="예: 신한 110-123-456789"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            업체별 계좌번호가 있으면 그 계좌가 우선 적용됩니다.
          </p>
        </div>
        <div className="md:col-span-2">
          <Label className="text-sm">정산서 하단 안내문</Label>
          <Input
            className="mt-1"
            value={s.footerNote}
            onChange={(e) => update({ footerNote: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 pt-2 border-t">
        <Checkbox
          id="oeunkyu-special"
          checked={s.oeunkyuSpecial}
          onCheckedChange={(v) => update({ oeunkyuSpecial: !!v })}
        />
        <Label htmlFor="oeunkyu-special" className="text-sm font-normal cursor-pointer">
          오은규 특수정산 적용 (오은규 금액을 오동선에게 합산)
        </Label>
      </div>
    </Card>
  );
}



function CompaniesTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Company[]>([]);
  const [name, setName] = useState("");
  const [leaders, setLeadersList] = useState<{ id: string; name: string }[]>([]);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupGroups, setDupGroups] = useState<Company[][]>([]);
  const [merging, setMerging] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualChecked, setManualChecked] = useState<Set<string>>(new Set());
  const [manualCanonical, setManualCanonical] = useState<string | null>(null);
  const [manualFilter, setManualFilter] = useState("");
  const [preview, setPreview] = useState<{
    group: Company[];
    canonical: Company;
    others: Company[];
    deliveries: any[];
    deliveriesTotal: number;
    prices: any[];
    pricesTotal: number;
    loading: boolean;
  } | null>(null);

  const load = async () => {
    const [{ data }, { data: ls }] = await Promise.all([
      supabase.from("companies").select("*").order("name"),
      supabase.from("team_leaders").select("id,name").eq("active", true).order("name"),
    ]);
    setRows((data as Company[]) || []);
    setLeadersList((ls as any) || []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim() || !user) return;
    const { error } = await supabase.from("companies").insert({ user_id: user.id, name: name.trim() });
    if (error) toast.error(error.message); else { setName(""); load(); }
  };

  const update = async (id: string, patch: Partial<Company>) => {
    const { error } = await supabase.from("companies").update(patch).eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  // 거부팀장 선택 시 같은 업체 내 중복 검사 후 저장.
  const setRejected = async (r: Company, slot: 1 | 2 | 3, value: string | null) => {
    const cur = {
      1: r.rejected_leader_id,
      2: r.rejected_leader_id_2,
      3: r.rejected_leader_id_3,
    } as Record<1 | 2 | 3, string | null>;
    cur[slot] = value;
    const picked = [cur[1], cur[2], cur[3]].filter(Boolean) as string[];
    if (new Set(picked).size !== picked.length) {
      toast.error("같은 거부팀장이 중복 등록되었습니다.");
      return;
    }
    const col =
      slot === 1 ? "rejected_leader_id" :
      slot === 2 ? "rejected_leader_id_2" :
      "rejected_leader_id_3";
    await update(r.id, { [col]: value } as any);
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("companies").delete().eq("id", id);
    load();
  };

  // 업체명 정규화: 공백/괄호/특수문자 제거, 소문자
  const normalize = (s: string) =>
    (s || "").toLowerCase().replace(/[\s\(\)\[\]\-_.,/\\·•:;'"`]+/g, "");

  // Levenshtein 거리
  const lev = (a: string, b: string) => {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
      let prev = dp[0];
      dp[0] = j;
      for (let i = 1; i <= a.length; i++) {
        const tmp = dp[i];
        dp[i] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[i], dp[i - 1]) + 1;
        prev = tmp;
      }
    }
    return dp[a.length];
  };
  // 유사도 (0~1)
  const similarity = (a: string, b: string) => {
    const A = normalize(a), B = normalize(b);
    if (!A || !B) return 0;
    const m = Math.max(A.length, B.length);
    return 1 - lev(A, B) / m;
  };

  const detectDups = () => {
    const map = new Map<string, Company[]>();
    for (const r of rows) {
      const k = normalize(r.name);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    const groups = Array.from(map.values()).filter((g) => g.length > 1);
    setDupGroups(groups);
    setDupOpen(true);
    if (groups.length === 0) toast.success("중복된 업체가 없습니다.");
  };

  // 유사 이름 검사: 임계값 이상 유사한 업체끼리 묶기 (Union-Find)
  const detectSimilar = (threshold = 0.7) => {
    const n = rows.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (x: number, y: number) => { const a = find(x), b = find(y); if (a !== b) parent[a] = b; };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = normalize(rows[i].name), b = normalize(rows[j].name);
        if (!a || !b) continue;
        if (a === b) { union(i, j); continue; }
        // 한쪽이 다른 쪽을 포함하면 유사로 간주
        if (a.includes(b) || b.includes(a)) { union(i, j); continue; }
        if (similarity(rows[i].name, rows[j].name) >= threshold) union(i, j);
      }
    }
    const buckets = new Map<number, Company[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!buckets.has(r)) buckets.set(r, []);
      buckets.get(r)!.push(rows[i]);
    }
    const groups = Array.from(buckets.values()).filter((g) => g.length > 1);
    setDupGroups(groups);
    setDupOpen(true);
    if (groups.length === 0) toast.success("유사한 업체가 없습니다.");
    else toast.info(`유사 후보 ${groups.length}개 그룹을 찾았습니다.`);
  };

  // 한 그룹을 canonical로 통합
  const mergeGroup = async (group: Company[], canonicalId: string) => {
    if (!user) { toast.error("로그인이 필요합니다."); return; }
    const canonical = group.find((g) => g.id === canonicalId);
    if (!canonical) { toast.error("기준 업체를 찾을 수 없습니다."); return; }
    const others = group.filter((g) => g.id !== canonicalId);
    const otherIds = others.map((o) => o.id);
    if (otherIds.length === 0) { toast.error("통합할 대상이 없습니다."); return; }
    if (otherIds.includes(canonical.id)) { toast.error("기준 업체가 대상에 포함되어 있습니다."); return; }
    setMerging(true);
    try {
      // 1) deliveries 재할당
      const { error: e1 } = await supabase
        .from("deliveries")
        .update({ company_id: canonical.id, company_name: canonical.name })
        .in("company_id", otherIds);
      if (e1) throw e1;
      // 2) 이름 기반 deliveries (company_id null 인 경우 대비)
      const otherNames = others.map((o) => o.name);
      if (otherNames.length > 0) {
        const { error: e2 } = await supabase
          .from("deliveries")
          .update({ company_id: canonical.id, company_name: canonical.name })
          .is("company_id", null)
          .in("company_name", otherNames);
        if (e2) throw e2;
      }
      // 3) price_list 재할당
      const { error: ep } = await supabase
        .from("price_list")
        .update({ company_id: canonical.id, company_name: canonical.name })
        .in("company_id", otherIds);
      if (ep) throw ep;
      // 3.5) 검증: 옮겨지지 않은 잔여 행이 있으면 중단(데이터 손실 방지)
      const [{ count: remDel }, { count: remPrice }] = await Promise.all([
        supabase.from("deliveries").select("id", { count: "exact", head: true }).in("company_id", otherIds),
        supabase.from("price_list").select("id", { count: "exact", head: true }).in("company_id", otherIds),
      ]);
      if ((remDel || 0) > 0 || (remPrice || 0) > 0) {
        throw new Error(`잔여 데이터(배송 ${remDel || 0}건 / 단가 ${remPrice || 0}건)가 남아 통합을 중단했습니다.`);
      }
      // 4) 중복 업체 삭제
      const { error: e3 } = await supabase.from("companies").delete().in("id", otherIds);
      if (e3) throw e3;
      toast.success(`${others.length}건을 "${canonical.name}"(으)로 통합했습니다.`);
      await load();
      // 그룹 갱신
      setDupGroups((prev) => prev.filter((g) => g !== group));
    } catch (err: any) {
      toast.error("통합 실패: " + (err?.message || String(err)));
    } finally {
      setMerging(false);
    }
  };

  // 통합 전 미리보기: 옮겨질 배송/단가 데이터를 조회
  const openPreview = async (group: Company[], canonicalId: string) => {
    const canonical = group.find((g) => g.id === canonicalId);
    if (!canonical) return;
    const others = group.filter((g) => g.id !== canonicalId);
    const otherIds = others.map((o) => o.id);
    const otherNames = others.map((o) => o.name);
    setPreview({
      group, canonical, others,
      deliveries: [], deliveriesTotal: 0, prices: [], pricesTotal: 0,
      loading: true,
    });
    try {
      // 배송: company_id 매칭 + (company_id null & 이름 매칭)
      const [byId, byName, priceRes] = await Promise.all([
        supabase
          .from("deliveries")
          .select("id,date,company_name,leader1_name,customer_name,item,metro_fee,note_amount,regional_fee,cod_amount", { count: "exact" })
          .in("company_id", otherIds.length ? otherIds : ["00000000-0000-0000-0000-000000000000"])
          .order("date", { ascending: false })
          .limit(50),
        otherNames.length
          ? supabase
              .from("deliveries")
              .select("id,date,company_name,leader1_name,customer_name,item,metro_fee,note_amount,regional_fee,cod_amount", { count: "exact" })
              .is("company_id", null)
              .in("company_name", otherNames)
              .order("date", { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [], count: 0 } as any),
        supabase
          .from("price_list")
          .select("id,company_name,region_type,region_detail,item,spec,metro_fee,note_amount,regional_fee,cod_default", { count: "exact" })
          .in("company_id", otherIds.length ? otherIds : ["00000000-0000-0000-0000-000000000000"])
          .order("company_name")
          .limit(50),
      ]);
      const dels = [...((byId.data as any[]) || []), ...((byName.data as any[]) || [])].slice(0, 50);
      const delTotal = (byId.count || 0) + (byName.count || 0);
      setPreview({
        group, canonical, others,
        deliveries: dels,
        deliveriesTotal: delTotal,
        prices: (priceRes.data as any[]) || [],
        pricesTotal: priceRes.count || 0,
        loading: false,
      });
    } catch (err: any) {
      toast.error("미리보기 실패: " + (err?.message || String(err)));
      setPreview(null);
    }
  };

  const confirmMerge = async () => {
    if (!preview) return;
    const { group, canonical } = preview;
    setPreview(null);
    await mergeGroup(group, canonical.id);
  };

  const mergeAll = async () => {
    if (!confirm(`총 ${dupGroups.length}개 그룹을 자동 통합합니다. 진행할까요?\n(각 그룹에서 가장 먼저 등록된 업체를 기준으로 합칩니다)`)) return;
    for (const g of [...dupGroups]) {
      // canonical = 가장 먼저 등록된(이름 알파벳 우선) → 여기선 단순히 첫 번째
      const canonical = g[0];
      await mergeGroup(g, canonical.id);
    }
  };

  // 지정 통합: 사용자가 직접 통합할 업체를 선택
  const openManual = () => {
    setManualChecked(new Set());
    setManualCanonical(null);
    setManualFilter("");
    setManualOpen(true);
  };
  const toggleManual = (id: string) => {
    setManualChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (manualCanonical === id) setManualCanonical(null);
      } else next.add(id);
      return next;
    });
  };
  const proceedManual = async () => {
    const ids = Array.from(manualChecked);
    if (ids.length < 2) { toast.error("2개 이상 선택해 주세요."); return; }
    if (!manualCanonical || !manualChecked.has(manualCanonical)) {
      toast.error("기준 업체를 선택해 주세요.");
      return;
    }
    const group = rows.filter((r) => manualChecked.has(r.id));
    setManualOpen(false);
    await openPreview(group, manualCanonical);
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex gap-2">
        <Input placeholder="업체명" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add}><Plus className="h-4 w-4 mr-1" />추가</Button>
        <Button variant="outline" onClick={detectDups}>중복 검사</Button>
        <Button variant="outline" onClick={() => detectSimilar(0.7)}>유사 이름 검사</Button>
        <Button variant="outline" onClick={openManual}>지정 통합</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>업체명</TableHead>
            <TableHead>계산서</TableHead>
            <TableHead>계좌번호</TableHead>
            <TableHead>정산주기</TableHead>
            <TableHead>거부팀장1</TableHead>
            <TableHead>거부팀장2</TableHead>
            <TableHead>거부팀장3</TableHead>
            <TableHead>착불유무</TableHead>
            <TableHead>사용</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })} /></TableCell>
              <TableCell><Checkbox checked={r.issues_invoice} onCheckedChange={(v) => update(r.id, { issues_invoice: !!v })} /></TableCell>
              <TableCell>
                <Input
                  className="w-44"
                  placeholder="예: 신한 110-123-456"
                  defaultValue={r.account_number || ""}
                  onBlur={(e) => e.target.value !== (r.account_number || "") && update(r.id, { account_number: e.target.value || null } as any)}
                />
              </TableCell>
              <TableCell>
                <Select
                  value={r.settlement_cycle || "biweekly"}
                  onValueChange={(v) => update(r.id, { settlement_cycle: v } as any)}
                >
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="biweekly">보름</SelectItem>
                    <SelectItem value="monthly">한달</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              {([1, 2, 3] as const).map((slot) => {
                const val =
                  slot === 1 ? r.rejected_leader_id :
                  slot === 2 ? r.rejected_leader_id_2 :
                  r.rejected_leader_id_3;
                return (
                  <TableCell key={slot}>
                    <Select
                      value={val || "__none__"}
                      onValueChange={(v) => setRejected(r, slot, v === "__none__" ? null : v)}
                    >
                      <SelectTrigger className="w-32"><SelectValue placeholder="없음" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">없음</SelectItem>
                        {leaders.map((l) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                );
              })}
              <TableCell><Checkbox checked={!!r.has_cod} onCheckedChange={(v) => update(r.id, { has_cod: !!v } as any)} /></TableCell>
              <TableCell><Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} /></TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">등록된 업체가 없습니다</TableCell></TableRow>}
        </TableBody>
      </Table>
      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>업체 중복 검사 결과</DialogTitle>
          </DialogHeader>
          {dupGroups.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">중복된 업체가 없습니다.</div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="text-xs text-muted-foreground">
                같은 이름(공백/특수문자 무시)으로 묶인 그룹입니다. 기준 업체를 선택하면 나머지가 그 업체로 통합되며, 모든 배송/단가 데이터가 옮겨집니다.
              </div>
              {dupGroups.map((g, gi) => (
                <Card key={gi} className="p-3 space-y-2">
                  <div className="text-sm font-medium">그룹 {gi + 1} · {g.length}개</div>
                  <div className="space-y-1">
                    {g.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex-1 truncate">
                          <span className="font-medium">{c.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {c.active ? "사용중" : "미사용"} · {c.issues_invoice ? "계산서" : "노계산서"}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={merging}
                          onClick={() => openPreview(g, c.id)}
                        >
                          이 업체로 통합 (미리보기)
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
          <DialogFooter>
            {dupGroups.length > 0 && (
              <Button onClick={mergeAll} disabled={merging}>전체 자동 통합</Button>
            )}
            <Button variant="outline" onClick={() => setDupOpen(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>통합 미리보기</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div>
                  기준 업체: <span className="font-bold">{preview.canonical.name}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  통합 대상({preview.others.length}개): {preview.others.map((o) => o.name).join(", ")}
                </div>
                <div className="mt-2 flex gap-4 text-xs">
                  <span>배송 기록: <b>{preview.loading ? "…" : preview.deliveriesTotal}</b>건 이동</span>
                  <span>단가표: <b>{preview.loading ? "…" : preview.pricesTotal}</b>건 이동</span>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  배송 기록 미리보기 (최대 50건)
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        {["날짜", "현재업체명", "팀장", "고객", "품목", "수도권", "비고금액", "지방", "착불"].map((h) => (
                          <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.deliveries.map((d) => (
                        <tr key={d.id} className="border-t">
                          <td className="px-2 py-1 whitespace-nowrap">{d.date}</td>
                          <td className="px-2 py-1">{d.company_name}</td>
                          <td className="px-2 py-1">{d.leader1_name || ""}</td>
                          <td className="px-2 py-1">{d.customer_name || ""}</td>
                          <td className="px-2 py-1 truncate max-w-[160px]">{d.item || ""}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(d.metro_fee || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(d.note_amount || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(d.regional_fee || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(d.cod_amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      {!preview.loading && preview.deliveries.length === 0 && (
                        <tr><td colSpan={9} className="px-2 py-3 text-center text-muted-foreground">이동할 배송 기록이 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  단가표 미리보기 (최대 50건)
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        {["현재업체명", "권역", "상세", "품목", "규격", "수도권", "비고금액", "지방", "착불기본"].map((h) => (
                          <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.prices.map((p) => (
                        <tr key={p.id} className="border-t">
                          <td className="px-2 py-1">{p.company_name}</td>
                          <td className="px-2 py-1">{p.region_type || ""}</td>
                          <td className="px-2 py-1">{p.region_detail || ""}</td>
                          <td className="px-2 py-1 truncate max-w-[160px]">{p.item || ""}</td>
                          <td className="px-2 py-1">{p.spec || ""}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(p.metro_fee || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(p.note_amount || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(p.regional_fee || 0).toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(p.cod_default || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                      {!preview.loading && preview.prices.length === 0 && (
                        <tr><td colSpan={9} className="px-2 py-3 text-center text-muted-foreground">이동할 단가표가 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground">
                실행하면 위 데이터의 업체가 <b>{preview.canonical.name}</b>(으)로 변경되고, 기존 중복 업체 {preview.others.length}개는 삭제됩니다. 되돌릴 수 없습니다.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={merging}>취소</Button>
            <Button onClick={confirmMerge} disabled={merging || !preview || preview.loading}>
              {merging ? "통합 중…" : "통합 실행"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LeadersTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Leader[]>([]);
  const [name, setName] = useState("");

  const load = async () => {
    const { data } = await supabase.from("team_leaders").select("*").order("name");
    setRows((data as Leader[]) || []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim() || !user) return;
    const { error } = await supabase.from("team_leaders").insert({ user_id: user.id, name: name.trim() });
    if (error) toast.error(error.message); else { setName(""); load(); }
  };

  const update = async (id: string, patch: Partial<Leader>) => {
    const { error } = await supabase.from("team_leaders").update(patch).eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("team_leaders").delete().eq("id", id);
    load();
  };

  const dupCounts = detectDuplicates(rows);

  /** 별칭 1개만 허용 */
  const updateAlias = async (id: string, value: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const v = value.trim();
    const toSave = v ? [v] : [];
    const conflict = findAliasConflict(id, toSave, rows);
    if (conflict) { toast.error(conflict); load(); return; }
    await update(id, { aliases: toSave } as any);
  };

  const updateName = async (id: string, nextName: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const trimmed = nextName.trim();
    if (!trimmed) { toast.error("팀장명은 비울 수 없습니다"); load(); return; }
    const conflict = findDisplayNameConflict(id, trimmed, row.display_suffix || null, rows);
    if (conflict) { toast.error(conflict); load(); return; }
    await update(id, { name: trimmed });
  };

  const updateSuffix = async (id: string, nextSuffix: string | null) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const conflict = findDisplayNameConflict(id, row.name, nextSuffix, rows);
    if (conflict) { toast.error(conflict); load(); return; }
    await update(id, { display_suffix: nextSuffix } as any);
  };

  const [cleaning, setCleaning] = useState(false);

  /**
   * 기존 deliveries에서 별칭으로 저장된 팀장명을 찾아 정식 팀장명/ID로 통합.
   * - leaderN_id가 비었지만 leaderN_name이 별칭과 매칭되면 ID/이름 채움
   * - leaderN_id가 있으면 leaderN_name을 해당 팀장의 정식 이름으로 동기화
   */
  const cleanLeaderNames = async () => {
    if (!confirm("기존 기록의 팀장 이름을 정식 팀장명으로 통합합니다. 진행하시겠습니까?")) return;
    setCleaning(true);
    try {
      const matchable = rows;
      const byId = new Map(rows.map((l) => [l.id, l]));

      // 전체 deliveries 로드 (페이지네이션)
      const all: any[] = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await supabase
          .from("deliveries")
          .select("id,leader1_id,leader1_name,leader2_id,leader2_name,leader3_id,leader3_name")
          .range(from, from + page - 1);
        if (error) throw error;
        const chunk = data || [];
        all.push(...chunk);
        if (chunk.length < page) break;
      }

      let updated = 0, matched = 0, renamed = 0, ambiguous = 0;
      for (const r of all) {
        const patch: any = {};
        for (const slot of [1, 2, 3] as const) {
          const idKey = `leader${slot}_id` as const;
          const nameKey = `leader${slot}_name` as const;
          const curId: string | null = r[idKey];
          const curName: string | null = r[nameKey];
          if (curId) {
            const l = byId.get(curId);
            if (l && l.name && (curName || "").trim() !== l.name.trim()) {
              patch[nameKey] = l.name;
              renamed++;
            }
          } else if (curName && curName.trim()) {
            const hit = resolveLeaderName(curName, matchable);
            if (hit) {
              patch[idKey] = hit.id;
              patch[nameKey] = hit.name;
              matched++;
            } else {
              // 매칭 실패 / 동명이인 미해소 — 변환하지 않고 카운트만
              ambiguous++;
            }
          }
        }
        if (Object.keys(patch).length) {
          const { error } = await supabase.from("deliveries").update(patch).eq("id", r.id);
          if (!error) updated++;
        }
      }
      toast.success(
        `정리 완료: ${updated}건 업데이트 (별칭 매칭 ${matched} · 이름 동기화 ${renamed} · 미해소 ${ambiguous})`,
      );
    } catch (e: any) {
      toast.error("정리 실패: " + (e?.message || String(e)));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex gap-2">
        <Input placeholder="팀장명" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add}><Plus className="h-4 w-4 mr-1" />추가</Button>
        <Button variant="outline" onClick={cleanLeaderNames} disabled={cleaning}>
          {cleaning ? "정리 중..." : "팀장 이름 정리"}
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">
        ‘팀장 이름 정리’: 기존 기록에서 별칭으로 저장된 팀장명을 정식 팀장명/ID로 통합합니다.
        별칭(예: 형주 → 강형주, 동석 → 신동석)이 등록되어 있어야 합니다.
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>정식 팀장명</TableHead>
            <TableHead className="min-w-[110px]">
              별칭(1개)
              <div className="text-[10px] text-amber-700 font-normal">거부기사 업체표시용</div>
            </TableHead>
            <TableHead>계산서</TableHead>
            <TableHead>수도권 수수료율</TableHead>
            <TableHead>지방 수수료율</TableHead>
            <TableHead>정산상태</TableHead>
            <TableHead>정산기사</TableHead>
            <TableHead>계좌번호</TableHead>
            <TableHead>사용여부</TableHead>
            <TableHead className="min-w-[120px]">최저보장</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isDup = (dupCounts.get(r.name.trim()) ?? 0) > 1;
            const al = r.aliases || [];
            const needsAlias = r.is_rejected && !(al[0] || "").trim();
            const settleTarget = r.settle_to_id ? rows.find((x) => x.id === r.settle_to_id) : null;
            const isSpecial = r.is_rejected && !!settleTarget;
            const acctTrim = (r.account_number || "").trim();
            const acctMissing = r.issues_invoice && !acctTrim;
            const acctTooShort = !!acctTrim && acctTrim.replace(/\s/g, "").length < 8;
            const excludedNoTarget = (r.settle_status || "included") === "excluded" && !r.settle_to_id && !r.is_rejected;
            const minGuaranteeInvalid = r.min_guarantee_enabled && (!r.min_guarantee_amount || r.min_guarantee_amount <= 0);
            return (
            <TableRow key={r.id}>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Input defaultValue={r.name} onBlur={(e) => e.target.value.trim() !== r.name && updateName(r.id, e.target.value)} />
                  {isDup && <span className="text-xs text-amber-600 whitespace-nowrap">동명이인</span>}
                </div>
                {isDup && <div className="text-xs text-muted-foreground mt-1">표시: {getDisplayName(r, rows)}</div>}
              </TableCell>
              <TableCell>
                <Input
                  className={`w-28 ${needsAlias ? "border-destructive" : ""}`}
                  defaultValue={al[0] || ""}
                  placeholder={r.is_rejected ? "업체 표시명 (필수)" : "예: 동선"}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if ((v.trim() || "") !== (al[0] || "")) {
                      updateAlias(r.id, v);
                    }
                  }}
                />
                {needsAlias && (
                  <div className="text-[10px] text-destructive mt-1">거부기사 표시용 별칭 필요</div>
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={r.issues_invoice ? "yes" : "no"}
                  onValueChange={(v) => {
                    const next = v === "yes";
                    update(r.id, { issues_invoice: next } as any);
                    if (next && !acctTrim) toast.warning(`${r.name}: 계산서 발행 시 계좌번호가 필요합니다`);
                  }}
                >
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">발행</SelectItem>
                    <SelectItem value="no">미발행</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell><Input type="number" className="w-24" defaultValue={r.fee_rate_metro ?? 0} onBlur={(e) => update(r.id, { fee_rate_metro: Number(e.target.value) } as any)} /></TableCell>
              <TableCell><Input type="number" className="w-24" defaultValue={r.fee_rate_regional ?? 0} onBlur={(e) => update(r.id, { fee_rate_regional: Number(e.target.value) } as any)} /></TableCell>
              <TableCell>
                <Select
                  value={r.settle_status || "included"}
                  onValueChange={(v) => {
                    update(r.id, { settle_status: v } as any);
                    if (v === "excluded" && !r.settle_to_id && !r.is_rejected) {
                      toast.warning(`${r.name}: 정산제외 시 정산귀속 또는 거부 설정을 확인하세요`);
                    }
                  }}
                >
                  <SelectTrigger className={`w-28 ${excludedNoTarget ? "border-destructive" : ""}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="included">정산포함</SelectItem>
                    <SelectItem value="excluded">정산제외</SelectItem>
                  </SelectContent>
                </Select>
                {excludedNoTarget && <div className="text-[10px] text-destructive mt-1">귀속 미지정</div>}
              </TableCell>
              <TableCell>
                <Select value={r.settle_to_id || "none"} onValueChange={(v) => update(r.id, { settle_to_id: v === "none" ? null : v })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">본인</SelectItem>
                    {rows.filter((x) => x.id !== r.id).map((x) => <SelectItem key={x.id} value={x.id}>{getDisplayName(x, rows)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  className={`w-36 ${acctMissing ? "border-destructive" : ""}`}
                  defaultValue={r.account_number || ""}
                  placeholder="은행 000-000"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (r.account_number || null)) {
                      update(r.id, { account_number: v } as any);
                    }
                  }}
                />
                {acctMissing && <div className="text-[10px] text-destructive mt-1">계좌번호 필요</div>}
                {!acctMissing && acctTooShort && <div className="text-[10px] text-amber-600 mt-1">형식 확인</div>}
              </TableCell>
              <TableCell><Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} /></TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Checkbox
                    checked={r.min_guarantee_enabled}
                    onCheckedChange={(v) => {
                      const enabled = !!v;
                      update(r.id, { min_guarantee_enabled: enabled } as any);
                      if (enabled && (!r.min_guarantee_amount || r.min_guarantee_amount <= 0)) {
                        toast.warning(`${r.name}: 최저보장 금액을 입력하세요`);
                      }
                    }}
                  />
                  <Input
                    type="number"
                    className={`w-24 ${minGuaranteeInvalid ? "border-destructive" : ""}`}
                    disabled={!r.min_guarantee_enabled}
                    defaultValue={r.min_guarantee_amount ?? 0}
                    onBlur={(e) => {
                      let v = Number(e.target.value) || 0;
                      if (v < 0) {
                        toast.error(`${r.name}: 최저보장 금액은 0 이상이어야 합니다`);
                        e.target.value = String(r.min_guarantee_amount ?? 0);
                        return;
                      }
                      if (v !== (r.min_guarantee_amount ?? 0)) update(r.id, { min_guarantee_amount: v } as any);
                      if (r.min_guarantee_enabled && v <= 0) {
                        toast.warning(`${r.name}: 최저보장이 켜져 있지만 금액이 0 입니다`);
                      }
                    }}
                  />
                </div>
                {minGuaranteeInvalid && <div className="text-[10px] text-destructive mt-1">금액 입력 필요</div>}
              </TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">등록된 팀장이 없습니다</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}


type CommonDeduction = { id: string; label: string; amount: number; active: boolean; sort_order: number };

function CommonDeductionsTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<CommonDeduction[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("common_deductions")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) { toast.error("불러오기 실패: " + error.message); return; }
    let list = (data as CommonDeduction[]) || [];
    // 최초 진입 시 쓰레기비용 50,000 기본 시드
    if (list.length === 0 && user) {
      const { data: ins, error: e2 } = await supabase
        .from("common_deductions")
        .insert({ user_id: user.id, label: "쓰레기비용", amount: 50000, active: true, sort_order: 0 })
        .select()
        .single();
      if (!e2 && ins) list = [ins as CommonDeduction];
    }
    setRows(list);
  };
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const addRow = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("common_deductions")
      .insert({ user_id: user.id, label: "", amount: 0, active: true, sort_order: rows.length })
      .select()
      .single();
    if (error) { toast.error("추가 실패: " + error.message); return; }
    setRows([...rows, data as CommonDeduction]);
  };

  const update = (id: string, patch: Partial<CommonDeduction>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    const { error } = await supabase.from("common_deductions").delete().eq("id", id);
    if (error) { toast.error("삭제 실패: " + error.message); return; }
    setRows(rows.filter((r) => r.id !== id));
  };

  const saveAll = async () => {
    setLoading(true);
    for (const r of rows) {
      await supabase
        .from("common_deductions")
        .update({ label: r.label, amount: Number(r.amount) || 0, active: r.active, sort_order: r.sort_order })
        .eq("id", r.id);
    }
    setLoading(false);
    toast.success("저장 완료");
    load();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">공통 공제 관리</h3>
          <p className="text-sm text-muted-foreground">모든 정산대상 팀장에게 자동 적용됩니다. (예: 쓰레기비용 50,000)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />항목 추가</Button>
          <Button size="sm" onClick={saveAll} disabled={loading}>저장</Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>공제내용</TableHead>
            <TableHead className="w-40 text-right">공제금액</TableHead>
            <TableHead className="w-24 text-center">적용</TableHead>
            <TableHead className="w-16"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Input value={r.label} onChange={(e) => update(r.id, { label: e.target.value })} placeholder="예: 쓰레기비용" />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  className="text-right"
                  value={r.amount}
                  onChange={(e) => update(r.id, { amount: Number(e.target.value) || 0 })}
                />
              </TableCell>
              <TableCell className="text-center">
                <Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} />
              </TableCell>
              <TableCell>
                <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">공통 공제 항목이 없습니다</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
