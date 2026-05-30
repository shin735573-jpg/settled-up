import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-center text-muted-foreground">불러오는 중...</div>;
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}