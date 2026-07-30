import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import Auth from "./pages/Auth";
import OAuthConsent from "./pages/OAuthConsent";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Records from "./pages/Records";
import RecordsBrowse from "./pages/RecordsBrowse";
import MergeHistory from "./pages/MergeHistory";
import MobileHome from "./pages/MobileHome";
import CompanySettlement from "./pages/CompanySettlement";
import LeaderSettlement from "./pages/LeaderSettlement";
import Summary from "./pages/Summary";
import HQSettlement from "./pages/HQSettlement";
import Holidays from "./pages/Holidays";
import Saves from "./pages/Saves";
import Verify from "./pages/Verify";
import Settings from "./pages/Settings";
import SpecTests from "./pages/SpecTests";
import OcrTest from "./pages/OcrTest";
import SaveConflicts from "./pages/SaveConflicts";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<RouteErrorBoundary routeName="Auth"><Auth /></RouteErrorBoundary>} />
            <Route path="/.lovable/oauth/consent" element={<RouteErrorBoundary routeName="OAuthConsent"><OAuthConsent /></RouteErrorBoundary>} />
            <Route path="/forgot-password" element={<RouteErrorBoundary routeName="ForgotPassword"><ForgotPassword /></RouteErrorBoundary>} />
            <Route path="/reset-password" element={<RouteErrorBoundary routeName="ResetPassword"><ResetPassword /></RouteErrorBoundary>} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/" element={<RouteErrorBoundary routeName="MobileHome (/)"><MobileHome /></RouteErrorBoundary>} />
              <Route path="/records" element={<RouteErrorBoundary routeName="Records (/records)"><Records /></RouteErrorBoundary>} />
              <Route path="/records-browse" element={<RouteErrorBoundary routeName="RecordsBrowse (/records-browse)"><RecordsBrowse /></RouteErrorBoundary>} />
              <Route path="/merge-history" element={<RouteErrorBoundary routeName="MergeHistory (/merge-history)"><MergeHistory /></RouteErrorBoundary>} />
              <Route path="/company-settlement" element={<RouteErrorBoundary routeName="CompanySettlement (/company-settlement)"><CompanySettlement /></RouteErrorBoundary>} />
              <Route path="/leader-settlement" element={<RouteErrorBoundary routeName="LeaderSettlement (/leader-settlement)"><LeaderSettlement /></RouteErrorBoundary>} />
              <Route path="/summary" element={<RouteErrorBoundary routeName="Summary (/summary)"><Summary /></RouteErrorBoundary>} />
              <Route path="/hq-settlement" element={<RouteErrorBoundary routeName="HQSettlement (/hq-settlement)"><HQSettlement /></RouteErrorBoundary>} />
              <Route path="/holidays" element={<RouteErrorBoundary routeName="Holidays (/holidays)"><Holidays /></RouteErrorBoundary>} />
              <Route path="/saves" element={<RouteErrorBoundary routeName="Saves (/saves)"><Saves /></RouteErrorBoundary>} />
              <Route path="/verify" element={<RouteErrorBoundary routeName="Verify (/verify)"><Verify /></RouteErrorBoundary>} />
              <Route path="/settings" element={<RouteErrorBoundary routeName="Settings (/settings)"><Settings /></RouteErrorBoundary>} />
              <Route path="/spec-tests" element={<RouteErrorBoundary routeName="SpecTests (/spec-tests)"><SpecTests /></RouteErrorBoundary>} />
              <Route path="/ocr-test" element={<RouteErrorBoundary routeName="OcrTest (/ocr-test)"><OcrTest /></RouteErrorBoundary>} />
              <Route path="/save-conflicts" element={<RouteErrorBoundary routeName="SaveConflicts (/save-conflicts)"><SaveConflicts /></RouteErrorBoundary>} />
            </Route>
            <Route path="*" element={<RouteErrorBoundary routeName="NotFound"><NotFound /></RouteErrorBoundary>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
