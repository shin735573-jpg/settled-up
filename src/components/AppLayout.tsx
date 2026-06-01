import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, FileSpreadsheet, Building2, Users, Settings as SettingsIcon, Eye, Landmark, CalendarOff, Save, Search } from "lucide-react";
import { useEffect } from "react";
import { maybeRunDailyBackup } from "@/lib/excelBackup";

const nav = [
  { to: "/records", label: "기록입력", icon: FileSpreadsheet },
  { to: "/records-browse", label: "배송내역 조회", icon: Search },
  { to: "/company-settlement", label: "업체정산", icon: Building2 },
  { to: "/leader-settlement", label: "팀장정산", icon: Users },
  { to: "/hq-settlement", label: "본사정산", icon: Landmark },
  { to: "/summary", label: "한눈요약", icon: Eye },
  { to: "/holidays", label: "휴무일관리", icon: CalendarOff },
  { to: "/settings", label: "설정", icon: SettingsIcon },
  { to: "/saves", label: "정산서저장", icon: Save },
];

export default function AppLayout() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => { await signOut(); navigate("/auth"); };
  // 24h 1회 자동 백업 (사용자가 켰을 때만). 실패는 조용히 무시.
  useEffect(() => {
    if (!user?.id) return;
    const t = setTimeout(() => { void maybeRunDailyBackup(user.id); }, 1500);
    return () => clearTimeout(t);
  }, [user?.id]);
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-muted/30">
      <aside className="md:w-56 md:min-h-screen bg-card border-r flex flex-col w-full print:hidden">
        <div className="px-3 py-2 md:px-4 md:py-3 border-b w-full flex items-center justify-between gap-2 md:block">
          <Link to="/" className="min-w-0 flex-1 md:flex-none">
            <div className="font-bold text-base md:text-lg leading-tight">삼호정산표</div>
            <div className="hidden md:block text-xs text-muted-foreground truncate">{user?.email}</div>
          </Link>
          {/* 모바일: 헤더 우측 로그아웃 버튼 */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0"
            onClick={handleLogout}
            aria-label="로그아웃"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
        <nav className="hidden md:flex md:flex-col flex-1 md:overflow-visible">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap hover:bg-accent min-h-[44px] ${
                  isActive
                    ? "bg-primary text-primary-foreground font-bold border-l-4 border-primary shadow-sm"
                    : "text-foreground/80"
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t hidden md:block">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" /> 로그아웃
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-3 md:p-6 overflow-x-auto min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
