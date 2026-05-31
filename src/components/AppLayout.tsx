import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, FileSpreadsheet, Building2, Users, Settings as SettingsIcon, Eye, Landmark, CalendarOff, Save } from "lucide-react";
import { useEffect } from "react";
import { maybeRunDailyBackup } from "@/lib/excelBackup";

const nav = [
  { to: "/records", label: "기록입력", icon: FileSpreadsheet },
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
      <aside className="md:w-56 md:min-h-screen bg-card border-r flex md:flex-col w-full print:hidden">
        <div className="px-4 py-3 border-b w-full flex items-center justify-between gap-2 md:block">
          <div className="min-w-0">
            <div className="font-bold text-lg leading-tight">삼호정산표</div>
            <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
          </div>
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
        <nav className="flex flex-wrap md:flex-nowrap md:flex-col flex-1 md:overflow-visible">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex-1 md:flex-none basis-1/4 md:basis-auto flex items-center justify-center md:justify-start gap-1.5 md:gap-2 px-2 md:px-4 py-2.5 md:py-3 text-xs md:text-sm whitespace-nowrap hover:bg-accent min-h-[44px] ${
                  isActive ? "bg-accent font-semibold border-b-2 md:border-b-0 md:border-l-2 border-primary" : ""
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
