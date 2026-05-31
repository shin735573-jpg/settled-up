import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error("이메일 전송 실패: " + error.message);
      return;
    }
    setSent(true);
    toast.success("비밀번호 재설정 링크를 이메일로 보냈습니다.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">비밀번호 재설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          {sent ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                {email} 주소로 재설정 링크를 보냈습니다. 메일함을 확인해 주세요.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                다른 이메일로 다시 보내기
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="fp-email">이메일</Label>
                <Input
                  id="fp-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="가입한 이메일 주소"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "전송 중..." : "재설정 링크 보내기"}
              </Button>
            </form>
          )}
          <div className="text-center">
            <Link to="/auth" className="text-sm text-primary hover:underline">
              로그인 페이지로 돌아가기
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
