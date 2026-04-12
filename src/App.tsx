import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { CommandPalette } from "@/components/CommandPalette";
import Projects from "./pages/Projects";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import HiveGraph from "./pages/HiveGraph";
import ChatCentral from "./pages/ChatCentral";
import CodeVersioning from "./pages/CodeVersioning";
import Insights from "./pages/Insights";
import SpecPlan from "./pages/SpecPlan";
import Modules from "./pages/Modules";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <CommandPalette />
        <Routes>
          {/* Full-screen routes (no chrome) */}
          <Route path="/" element={<Projects />} />
          <Route path="/onboarding" element={<Onboarding />} />

          {/* App routes with sidebar + top bar */}
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/hive-graph" element={<HiveGraph />} />
            <Route path="/chat" element={<ChatCentral />} />
            <Route path="/code" element={<CodeVersioning />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/spec" element={<SpecPlan />} />
            <Route path="/modules" element={<Modules />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
