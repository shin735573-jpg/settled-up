import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { session } = useAuth();

  useEffect(() => { if (session) navigate("/", { replace: true }); }, [session, navigate]);

  const signInWithGoogle = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      toast.error("구글 로그인 실패: " + result.error.message);
      return;
    }
    if (result.redirected) return;
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">삼호정산표</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <p className="text-center text-sm text-muted-foreground">
            Google 계정으로 로그인하세요.
          </p>
          <Button type="button" variant="outline" className="w-full" onClick={signInWithGoogle} disabled={loading}>
            Google로 로그인
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}