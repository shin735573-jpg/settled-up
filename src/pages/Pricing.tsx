import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { fmt, parseNum } from "@/lib/format";
import { toast } from "sonner";

type Company = { id: string; name: string; active: boolean };
type Price = {
  id: string;
  company_id: string | null;
  company_name: string;
  region_type: "metro" | "regional";
  region_detail: string | null;
  item: string | null;
  spec: string | null;
  metro_fee: number;
  note_amount: number;
  regional_fee: number;
  cod_default: number;
  note: string | null;
  active: boolean;
};

type FormState = {
  id: string | null;
  company_id: string;
  company_name: string;
  region_type: "metro" | "regional";
  region_detail: string;
  item: string;
  spec: string;
  metro_fee: string;
  note_amount: string;
  regional_fee: string;
  cod_default: string;
  note: string;
  active: boolean;
};

const NONE = "__none__";
const NEW_COMPANY = "__new__";

const empty = (): FormState => ({
  id: null,
  company_id: "",
  company_name: "",
  region_type: "metro",
  region_detail: "",
  item: "",
  spec: "",
  metro_fee: "",
  note_amount: "",
  regional_fee: "",
  cod_default: "",
  note: "",
  active: true,
});

export default function Pricing() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rows, setRows] = useState<Price[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty());
  const [saving, setSaving] = useState(false);

  // 필터
  const [fCompany, setFCompany] = useState("");
  const [fRegion, setFRegion] = useState<string>("all");
  const [fDetail, setFDetail] = useState("");
  const [fItem, setFItem] = useState("");
  const [fActive, setFActive] = useState<string>("active");

  const load = async () => {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("companies").select("id,name,active").order("name"),
      supabase.from("price_list").select("*").order("company_name").order("region_type").order("region_detail"),
    ]);
    setCompanies((c as Company[]) || []);
    setRows((p as Price[]) || []);
  };
  useEffect(() => { load(); }, []);

  const activeCompanies = useMemo(() => companies.filter((c) => c.active), [companies]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (fCompany && !r.company_name.toLowerCase().includes(fCompany.toLowerCase())) return false;
      if (fRegion !== "all" && r.region_type !== fRegion) return false;
      if (fDetail && !(r.region_detail || "").toLowerCase().includes(fDetail.toLowerCase())) return false;
      if (fItem && !(r.item || "").toLowerCase().includes(fItem.toLowerCase())) return false;
      if (fActive === "active" && !r.active) return false;
      if (fActive === "inactive" && r.active) return false;
      return true;
    });
  }, [rows, fCompany, fRegion, fDetail, fItem, fActive]);

  const total = parseNum(form.metro_fee) + parseNum(form.note_amount) + parseNum(form.regional_fee);

  const openNew = () => { setForm(empty()); setOpen(true); };
  const openEdit = (r: Price) => {
    setForm({
      id: r.id,
      company_id: r.company_id || "",
      company_name: r.company_name,
      region_type: r.region_type,
      region_detail: r.region_detail || "",
      item: r.item || "",
      spec: r.spec || "",
      metro_fee: String(r.metro_fee ?? ""),
      note_amount: String(r.note_amount ?? ""),
      regional_fee: String(r.regional_fee ?? ""),
      cod_default: String(r.cod_default ?? ""),
      note: r.note || "",
      active: r.active,
    });
    setOpen(true);
  };

  const removeRow = async (id: string) => {
    if (!confirm("삭제하시겠습니까? (사용 안 함으로 비활성화도 가능합니다)")) return;
    const { error } = await supabase.from("price_list").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("삭제 완료");
    load();
  };

  const registerNewCompany = async (): Promise<string | null> => {
    if (!user) return null;
    const name = form.company_name.trim();
    if (!name) return null;
    const existing = companies.find((c) => c.name === name);
    if (existing) return existing.id;
    const { data, error } = await supabase
      .from("companies")
      .insert({ user_id: user.id, name, active: true, issues_invoice: false, vat_included: false, fee_rate_metro: 0, fee_rate_regional: 0 })
      .select("id,name,active").single();
    if (error) { toast.error(error.message); return null; }
    setCompanies((prev) => [...prev, data as Company]);
    toast.success(`신규 업체 등록: ${name}`);
    return (data as Company).id;
  };

  const save = async () => {
    if (!user) return;
    let companyId = form.company_id;
    let companyName = form.company_name.trim();
    if (!companyName) { toast.error("업체명을 입력하세요"); return; }
    if (!companyId) {
      const id = await registerNewCompany();
      if (!id) return;
      companyId = id;
    } else {
      const c = companies.find((x) => x.id === companyId);
      if (c) companyName = c.name;
    }

    // 중복 검사
    const dup = rows.find((r) =>
      r.id !== form.id &&
      r.company_name === companyName &&
      r.region_type === form.region_type &&
      (r.region_detail || "") === form.region_detail.trim() &&
      (r.item || "") === form.item.trim() &&
      (r.spec || "") === form.spec.trim()
    );
    if (dup) {
      if (!confirm("이미 등록된 단가입니다. 기존 단가를 수정하시겠습니까?")) return;
      openEdit(dup);
      return;
    }

    const payload = {
      user_id: user.id,
      company_id: companyId,
      company_name: companyName,
      region_type: form.region_type,
      region_detail: form.region_detail.trim() || null,
      item: form.item.trim() || null,
      spec: form.spec.trim() || null,
      metro_fee: parseNum(form.metro_fee),
      note_amount: parseNum(form.note_amount),
      regional_fee: parseNum(form.regional_fee),
      cod_default: parseNum(form.cod_default),
      note: form.note.trim() || null,
      active: form.active,
    };
    setSaving(true);
    let error;
    if (form.id) ({ error } = await supabase.from("price_list").update(payload).eq("id", form.id));
    else ({ error } = await supabase.from("price_list").insert(payload));
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(form.id ? "수정 완료" : "저장 완료");
    setOpen(false);
    setForm(empty());
    load();
  };

  const knownCompany = !!form.company_id || companies.some((c) => c.name === form.company_name.trim());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold flex-1">단가표</h1>
        <Button size="lg" onClick={openNew}>
          <Plus className="h-5 w-5 mr-1" /> 신규 단가 추가
        </Button>
      </div>

      <Card className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Input placeholder="업체명 검색" value={fCompany} onChange={(e) => setFCompany(e.target.value)} />
        <Select value={fRegion} onValueChange={setFRegion}>
          <SelectTrigger><SelectValue placeholder="지역구분" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 지역</SelectItem>
            <SelectItem value="metro">수도권</SelectItem>
            <SelectItem value="regional">지방</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="상세지역 검색" value={fDetail} onChange={(e) => setFDetail(e.target.value)} />
        <Input placeholder="품목 검색" value={fItem} onChange={(e) => setFItem(e.target.value)} />
        <Select value={fActive} onValueChange={setFActive}>
          <SelectTrigger><SelectValue placeholder="사용여부" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="active">사용</SelectItem>
            <SelectItem value="inactive">미사용</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <Card className="overflow-x-auto">
        <Table className="text-xs num w-max min-w-full">
          <TableHeader>
            <TableRow>
              {[
                ["업체", 140], ["구분", 80], ["상세지역", 140], ["품목", 180], ["규격", 120],
                ["수도권배송비", 120], ["비고금액", 110], ["지방배송비", 120], ["배송비총액", 120],
                ["착불기본", 110], ["비고", 200], ["사용", 70], ["", 100],
              ].map(([h, w]) => (
                <TableHead key={h as string} className="whitespace-nowrap" style={{ minWidth: `${w}px` }}>{h as string}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const t = Number(r.metro_fee) + Number(r.note_amount) + Number(r.regional_fee);
              return (
                <TableRow key={r.id} className={!r.active ? "opacity-50" : ""}>
                  <TableCell className="whitespace-nowrap">{r.company_name}</TableCell>
                  <TableCell>{r.region_type === "metro" ? "수도권" : "지방"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.region_detail || "-"}</TableCell>
                  <TableCell className="whitespace-pre-wrap break-words">{r.item || "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.spec || "-"}</TableCell>
                  <TableCell className="text-right">{fmt(r.metro_fee)}</TableCell>
                  <TableCell className="text-right">{fmt(r.note_amount)}</TableCell>
                  <TableCell className="text-right">{fmt(r.regional_fee)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(t)}</TableCell>
                  <TableCell className="text-right">{fmt(r.cod_default)}</TableCell>
                  <TableCell className="whitespace-pre-wrap break-words">{r.note || "-"}</TableCell>
                  <TableCell>{r.active ? "사용" : "미사용"}</TableCell>
                  <TableCell className="space-x-1 whitespace-nowrap">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => removeRow(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">등록된 단가가 없습니다.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        ※ 단가표는 참고/추천용입니다. 실제 정산은 기록입력에 저장된 금액 기준으로 계산됩니다.
      </p>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setForm(empty()); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "단가 수정" : "신규 단가 추가"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>업체명</Label>
              <div className="flex gap-2">
                <Select
                  value={form.company_id || NEW_COMPANY}
                  onValueChange={(v) => {
                    if (v === NEW_COMPANY) {
                      setForm({ ...form, company_id: "", company_name: "" });
                    } else {
                      const c = activeCompanies.find((x) => x.id === v);
                      setForm({ ...form, company_id: v, company_name: c?.name || "" });
                    }
                  }}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder="업체 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_COMPANY}>(직접 입력 / 신규)</SelectItem>
                    {activeCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="업체명 직접 입력"
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value, company_id: "" })}
                  className="flex-1"
                />
              </div>
              {!knownCompany && form.company_name.trim() && (
                <p className="text-xs text-destructive">설정에 없는 업체입니다. 저장 시 자동 등록됩니다.</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>지역구분</Label>
              <Select value={form.region_type} onValueChange={(v) => setForm({ ...form, region_type: v as "metro" | "regional" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="metro">수도권</SelectItem>
                  <SelectItem value="regional">지방</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>상세지역</Label>
              <Input value={form.region_detail} onChange={(e) => setForm({ ...form, region_detail: e.target.value })} placeholder="예: 강남구, 장기동, 부산 등" />
            </div>

            <div className="space-y-1">
              <Label>품목</Label>
              <Input value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>규격</Label>
              <Input value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>수도권배송비</Label>
              <Input inputMode="numeric" value={form.metro_fee} onChange={(e) => setForm({ ...form, metro_fee: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>비고금액</Label>
              <Input inputMode="numeric" value={form.note_amount} onChange={(e) => setForm({ ...form, note_amount: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>지방배송비</Label>
              <Input inputMode="numeric" value={form.regional_fee} onChange={(e) => setForm({ ...form, regional_fee: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>착불 기본값</Label>
              <Input inputMode="numeric" value={form.cod_default} onChange={(e) => setForm({ ...form, cod_default: e.target.value })} />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label>배송비총액 (자동)</Label>
              <Input value={fmt(total)} readOnly className="bg-muted font-semibold" />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label>비고</Label>
              <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="flex items-center gap-2 h-10 px-3 border rounded-md cursor-pointer w-fit">
                <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: !!v })} />
                <span>{form.active ? "사용" : "미사용"}</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setForm(empty()); }}>취소</Button>
            <Button onClick={save} disabled={saving}>{form.id ? "수정 저장" : "저장"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
