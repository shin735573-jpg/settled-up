import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Records from "./pages/Records";
import CompanySettlement from "./pages/CompanySettlement";
import LeaderSettlement from "./pages/LeaderSettlement";
import Summary from "./pages/Summary";
import HQSettlement from "./pages/HQSettlement";
import Holidays from "./pages/Holidays";
import Saves from "./pages/Saves";
import Settings from "./pages/Settings";
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
            <Route path="/auth" element={<Auth />} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/" element={<Records />} />
              <Route path="/records" element={<Records />} />
              <Route path="/company-settlement" element={<CompanySettlement />} />
              <Route path="/leader-settlement" element={<LeaderSettlement />} />
              <Route path="/summary" element={<Summary />} />
              <Route path="/hq-settlement" element={<HQSettlement />} />
              <Route path="/holidays" element={<Holidays />} />
              <Route path="/saves" element={<Saves />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/pricing" element={<Pricing />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
