import { Link } from "react-router-dom";
import { FileSpreadsheet, Building2, Users, Landmark, Eye, CalendarOff, Settings as SettingsIcon, Save } from "lucide-react";
import Records from "./Records";

const tiles = [
  { to: "/records", label: "기록입력", icon: FileSpreadsheet },
  { to: "/company-settlement", label: "업체정산", icon: Building2 },
  { to: "/leader-settlement", label: "팀장정산", icon: Users },
  { to: "/hq-settlement", label: "본사정산", icon: Landmark },
  { to: "/summary", label: "한눈요약", icon: Eye },
  { to: "/holidays", label: "휴무일관리", icon: CalendarOff },
  { to: "/settings", label: "설정", icon: SettingsIcon },
  { to: "/saves", label: "정산서저장", icon: Save },
];

export default function MobileHome() {
  return (
    <>
      {/* 모바일: 한 화면 런처 */}
      <div className="md:hidden grid grid-cols-2 gap-3 h-[calc(100dvh-9rem)] min-h-0">
        {tiles.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-center justify-center gap-2 rounded-xl bg-card border shadow-sm active:scale-[0.98] active:bg-accent transition"
          >
            <Icon className="h-8 w-8 text-primary" />
            <span className="text-sm font-medium">{label}</span>
          </Link>
        ))}
      </div>
      {/* 데스크톱: 기존 기록입력 화면 */}
      <div className="hidden md:block">
        <Records />
      </div>
    </>
  );
}
