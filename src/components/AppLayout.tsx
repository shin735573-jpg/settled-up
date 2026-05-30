import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, LayoutDashboard, FileSpreadsheet, Building2, Users, Settings as SettingsIcon, Eye, Landmark, CalendarOff, Save, Tag } from "lucide-react";

const nav = [
  { to: "/records", label: "기록입력", icon: FileSpreadsheet },
  { to: "/pricing", label: "단가표", icon: Tag },
  { to: "/company-settlement", label: "업체정산", icon: Building2 },
  { to: "/leader-settlement", label: "팀장정산", icon: Users },
  { to: "/summary", label: "한눈요약", icon: Eye },
  { to: "/hq-settlement", label: "본사정산", icon: Landmark },
  { to: "/holidays", label: "휴무일관리", icon: CalendarOff },
  { to: "/settings", label: "설정", icon: SettingsIcon },
  { to: "/saves", label: "정산서저장", icon: Save },
];

export default function AppLayout() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-muted/30">
      <aside className="md:w-56 md:min-h-screen bg-card border-r flex md:flex-col">
        <div className="px-4 py-4 border-b w-full">
          <div className="font-bold text-lg">삼호정산표</div>
          <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
        </div>
        <nav className="flex md:flex-col flex-1 overflow-x-auto">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-3 text-sm whitespace-nowrap hover:bg-accent ${
                  isActive ? "bg-accent font-semibold border-l-2 border-primary" : ""
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t hidden md:block">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={async () => { await signOut(); navigate("/auth"); }}>
            <LogOut className="h-4 w-4 mr-2" /> 로그아웃
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-6 overflow-x-auto">
        <Outlet />
      </main>
    </div>
  );
}