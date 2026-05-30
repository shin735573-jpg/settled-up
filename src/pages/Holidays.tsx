import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

type Leader = { id: string; name: string };
type Holiday = { id: string; date: string; scope: string; team_leader_id: string | null; note: string | null };

export default function Holidays() {
  const { user } = useAuth();
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [rows, setRows] = useState<Holiday[]>([]);
  const [date, setDate] = useState("");
  const [scope, setScope] = useState<"hq" | "leader">("hq");
  const [leaderId, setLeaderId] = useState<string>("");
  const [note, setNote] = useState("");

  const load = async () => {
    const [{ data: l }, { data: h }] = await Promise.all([
      supabase.from("team_leaders").select("id,name").order("name"),
      supabase.from("holidays").select("*").order("date", { ascending: false }),
    ]);
    setLeaders((l as Leader[]) || []);
    setRows((h as Holiday[]) || []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!date) return toast.error("날짜를 선택하세요");
    if (scope === "leader" && !leaderId) return toast.error("팀장을 선택하세요");
    const { error } = await supabase.from("holidays").insert({
      user_id: user!.id, date, scope,
      team_leader_id: scope === "leader" ? leaderId : null,
      note: note || null,
    });
    if (error) return toast.error(error.message);
    setDate(""); setNote(""); setLeaderId("");
    load();
  };

  const del = async (id: string) => {
    await supabase.from("holidays").delete().eq("id", id);
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">휴무일관리</h1>
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select value={scope} onValueChange={(v: any) => setScope(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hq">본사 휴무</SelectItem>
              <SelectItem value="leader">팀장 휴무</SelectItem>
            </SelectContent>
          </Select>
          <Select value={leaderId} onValueChange={setLeaderId} disabled={scope !== "leader"}>
            <SelectTrigger><SelectValue placeholder="팀장 선택" /></SelectTrigger>
            <SelectContent>
              {leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="비고" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button onClick={add}>추가</Button>
        </div>
      </Card>
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>날짜</TableHead><TableHead>구분</TableHead><TableHead>팀장</TableHead><TableHead>비고</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.date}</TableCell>
                <TableCell>{r.scope === "hq" ? "본사" : "팀장"}</TableCell>
                <TableCell>{leaders.find((l) => l.id === r.team_leader_id)?.name || "-"}</TableCell>
                <TableCell>{r.note || "-"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">등록된 휴무일이 없습니다.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}