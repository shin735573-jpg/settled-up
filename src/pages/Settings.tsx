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

type Company = { id: string; name: string; issues_invoice: boolean; vat_included: boolean; fee_rate_metro: number; fee_rate_regional: number; active: boolean };
type Leader = { id: string; name: string; region: string | null; is_rejected: boolean; is_virtual: boolean; deduction_amount: number; trash_cost: number; settle_to_id: string | null; active: boolean };
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
        </TabsList>
        <TabsContent value="companies"><CompaniesTab /></TabsContent>
        <TabsContent value="leaders"><LeadersTab /></TabsContent>
        <TabsContent value="holidays"><HolidaysTab /></TabsContent>
      </Tabs>
    </div>
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
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Input defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })} /></TableCell>
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
                    {rows.filter((x) => x.id !== r.id).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell><Checkbox checked={r.active} onCheckedChange={(v) => update(r.id, { active: !!v })} /></TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">등록된 팀장이 없습니다</TableCell></TableRow>}
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