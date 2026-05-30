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
import { detectDuplicates, findAliasConflict, getDisplayName } from "@/lib/leaderResolver";

type Company = { id: string; name: string; issues_invoice: boolean; vat_included: boolean; fee_rate_metro: number; fee_rate_regional: number; active: boolean };
type Leader = { id: string; name: string; region: string | null; is_rejected: boolean; is_virtual: boolean; deduction_amount: number; trash_cost: number; settle_to_id: string | null; active: boolean; aliases: string[]; display_suffix: string | null };
type Holiday = { id: string; date: string; scope: string; team_leader_id: string | null };

export default function Settings() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">설정</h1>
      <Tabs defaultValue="companies">
        <TabsList>
          <TabsTrigger value="companies">업체</TabsTrigger>
          <TabsTrigger value="leaders">팀장</TabsTrigger>
          <TabsTrigger value="holidays">휴무일</TabsTrigger>
          <TabsTrigger value="onedrive">원드라이브</TabsTrigger>
        </TabsList>
        <TabsContent value="companies"><CompaniesTab /></TabsContent>
        <TabsContent value="leaders"><LeadersTab /></TabsContent>
        <TabsContent value="holidays"><HolidaysTab /></TabsContent>
        <TabsContent value="onedrive"><OneDriveTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function OneDriveTab() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  const verify = async () => {
    setLoading(true); setResult("");
    const { data, error } = await supabase.functions.invoke("onedrive-upload", { body: { action: "verify" } });
    setLoading(false);
    if (error) { toast.error("연결 실패: " + error.message); setResult("실패: " + error.message); return; }
    if (!data?.ok) { toast.error("연결 실패"); setResult(JSON.stringify(data, null, 2)); return; }
    toast.success("원드라이브 연결 정상");
    setResult(`드라이브: ${data.drive?.name || "-"} (소유자: ${data.drive?.owner || "-"})`);
  };

  const testUpload = async () => {
    setLoading(true);
    const text = `삼호정산표 연결 테스트 - ${new Date().toISOString()}`;
    const contentBase64 = btoa(unescape(encodeURIComponent(text)));
    const { data, error } = await supabase.functions.invoke("onedrive-upload", {
      body: {
        action: "upload",
        folder: "정산서_저장/_연결테스트",
        filename: `test_${Date.now()}.txt`,
        contentBase64,
        contentType: "text/plain; charset=utf-8",
      },
    });
    setLoading(false);
    if (error || !data?.ok) { toast.error("업로드 실패"); setResult(JSON.stringify(data || error, null, 2)); return; }
    toast.success("테스트 파일 업로드 완료");
    setResult(`업로드 성공: ${data.name}\n${data.webUrl || ""}`);
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="text-sm text-muted-foreground">
        원드라이브 커넥터는 워크스페이스에서 이미 연결되어 있습니다. 아래 버튼으로 연결 상태와 업로드 권한을 확인하세요.
        <br />정산서 PNG는 향후 <code>정산서_저장/YYYY-MM_월전체/업체|팀장/</code> 폴더에 자동 저장됩니다.
      </div>
      <div className="flex gap-2">
        <Button onClick={verify} disabled={loading}>연결 확인</Button>
        <Button onClick={testUpload} disabled={loading} variant="outline">테스트 파일 업로드</Button>
      </div>
      {result && <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap break-all">{result}</pre>}
    </Card>
  );
}

function CompaniesTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Company[]>([]);
  const [name, setName] = useState("");

  const load = async () => {
    const { data } = await supabase.from("companies").select("*").order("name");
    setRows((data as Company[]) || []);
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

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    await supabase.from("companies").delete().eq("id", id);
    load();
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex gap-2">
        <Input placeholder="업체명" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add}><Plus className="h-4 w-4 mr-1" />추가</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>업체명</TableHead>
            <TableHead>계산서</TableHead>
            <TableHead>부가세 포함</TableHead>
            <TableHead>수도권 수수료%</TableHead>
            <TableHead>지방 수수료%</TableHead>
            <TableHead>활성</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })} /></TableCell>
              <TableCell><Checkbox checked={r.issues_invoice} onCheckedChange={(v) => update(r.id, { issues_invoice: !!v })} /></TableCell>
              <TableCell><Checkbox checked={r.vat_included} onCheckedChange={(v) => update(r.id, { vat_included: !!v })} /></TableCell>
              <TableCell><Input type="number" className="w-20" defaultValue={r.fee_rate_metro} onBlur={(e) => update(r.id, { fee_rate_metro: Number(e.target.value) })} /></TableCell>
              <TableCell><Input type="number" className="w-20" defaultValue={r.fee_rate_regional} onBlur={(e) => update(r.id, { fee_rate_regional: Number(e.target.value) })} /></TableCell>
              <TableCell><Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} /></TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">등록된 업체가 없습니다</TableCell></TableRow>}
        </TableBody>
      </Table>
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

  const updateAliases = async (id: string, raw: string) => {
    const aliases = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const conflict = findAliasConflict(id, aliases, rows);
    if (conflict) { toast.error(conflict); load(); return; }
    await update(id, { aliases } as any);
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex gap-2">
        <Input placeholder="팀장명" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button onClick={add}><Plus className="h-4 w-4 mr-1" />추가</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>팀장명</TableHead>
            <TableHead>별칭 (쉼표 구분)</TableHead>
            <TableHead>구분명</TableHead>
            <TableHead>지역</TableHead>
            <TableHead>거부</TableHead>
            <TableHead>가상</TableHead>
            <TableHead>공제금</TableHead>
            <TableHead>쓰레기비</TableHead>
            <TableHead>정산귀속</TableHead>
            <TableHead>활성</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isDup = (dupCounts.get(r.name.trim()) ?? 0) > 1;
            return (
            <TableRow key={r.id}>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })} />
                  {isDup && <span className="text-xs text-amber-600 whitespace-nowrap">동명이인</span>}
                </div>
                {isDup && <div className="text-xs text-muted-foreground mt-1">표시: {getDisplayName(r, rows)}</div>}
              </TableCell>
              <TableCell>
                <Input
                  className="w-40"
                  defaultValue={(r.aliases || []).join(", ")}
                  placeholder="예: 형주"
                  onBlur={(e) => {
                    const raw = e.target.value;
                    const next = raw.split(",").map((s) => s.trim()).filter(Boolean).join(", ");
                    const prev = (r.aliases || []).join(", ");
                    if (next !== prev) updateAliases(r.id, raw);
                  }}
                />
              </TableCell>
              <TableCell>
                <Input
                  className="w-20"
                  defaultValue={r.display_suffix || ""}
                  placeholder={isDup ? "예: 2" : ""}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (r.display_suffix || null)) update(r.id, { display_suffix: v } as any);
                  }}
                />
              </TableCell>
              <TableCell><Input className="w-24" defaultValue={r.region || ""} onBlur={(e) => update(r.id, { region: e.target.value })} /></TableCell>
              <TableCell><Checkbox checked={r.is_rejected} onCheckedChange={(v) => update(r.id, { is_rejected: !!v })} /></TableCell>
              <TableCell><Checkbox checked={r.is_virtual} onCheckedChange={(v) => update(r.id, { is_virtual: !!v })} /></TableCell>
              <TableCell><Input type="number" className="w-24" defaultValue={r.deduction_amount} onBlur={(e) => update(r.id, { deduction_amount: Number(e.target.value) })} /></TableCell>
              <TableCell><Input type="number" className="w-24" defaultValue={r.trash_cost} onBlur={(e) => update(r.id, { trash_cost: Number(e.target.value) })} /></TableCell>
              <TableCell>
                <Select value={r.settle_to_id || "none"} onValueChange={(v) => update(r.id, { settle_to_id: v === "none" ? null : v })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">본인</SelectItem>
                    {rows.filter((x) => x.id !== r.id).map((x) => <SelectItem key={x.id} value={x.id}>{getDisplayName(x, rows)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell><Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} /></TableCell>
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

function HolidaysTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Holiday[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [date, setDate] = useState("");
  const [scope, setScope] = useState("hq");
  const [leaderId, setLeaderId] = useState<string>("");

  const load = async () => {
    const { data } = await supabase.from("holidays").select("*").order("date", { ascending: false });
    setRows((data as Holiday[]) || []);
    const { data: l } = await supabase.from("team_leaders").select("*").order("name");
    setLeaders((l as Leader[]) || []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!date || !user) return;
    if (scope === "leader" && !leaderId) { toast.error("팀장을 선택하세요"); return; }
    const { error } = await supabase.from("holidays").insert({
      user_id: user.id, date, scope, team_leader_id: scope === "leader" ? leaderId : null,
    });
    if (error) toast.error(error.message); else { setDate(""); load(); }
  };

  const remove = async (id: string) => { await supabase.from("holidays").delete().eq("id", id); load(); };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div><Label>날짜</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div>
          <Label>구분</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hq">본사</SelectItem>
              <SelectItem value="leader">팀장</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope === "leader" && (
          <div>
            <Label>팀장</Label>
            <Select value={leaderId} onValueChange={setLeaderId}>
              <SelectTrigger className="w-40"><SelectValue placeholder="선택" /></SelectTrigger>
              <SelectContent>{leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <Button onClick={add}><Plus className="h-4 w-4 mr-1" />추가</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>날짜</TableHead><TableHead>구분</TableHead><TableHead>팀장</TableHead><TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.date}</TableCell>
              <TableCell>{r.scope === "hq" ? "본사" : "팀장"}</TableCell>
              <TableCell>{leaders.find((l) => l.id === r.team_leader_id)?.name || "-"}</TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">등록된 휴무일이 없습니다</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}