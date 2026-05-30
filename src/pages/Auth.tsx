import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export default function Auth() {
  const [email, setEmail] = useState("admin@test.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { session } = useAuth();

  useEffect(() => { if (session) navigate("/", { replace: true }); }, [session, navigate]);

  const signIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error("로그인 실패: " + error.message);
    else { toast.success("로그인 성공"); navigate("/"); }
  };

  const signUp = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setLoading(false);
    if (error) toast.error("회원가입 실패: " + error.message);
    else { toast.success("회원가입 완료. 바로 로그인됩니다."); navigate("/"); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">삼호정산표</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">로그인</TabsTrigger>
              <TabsTrigger value="signup">회원가입</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="space-y-4 pt-4">
              <div><Label>이메일</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></div>
              <div><Label>비밀번호</Label><Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" /></div>
              <Button className="w-full" onClick={signIn} disabled={loading}>로그인</Button>
            </TabsContent>
            <TabsContent value="signup" className="space-y-4 pt-4">
              <div><Label>이메일</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></div>
              <div><Label>비밀번호 (6자 이상)</Label><Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" /></div>
              <Button className="w-full" onClick={signUp} disabled={loading}>회원가입</Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}