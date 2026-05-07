import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { CommandPalette } from "@/components/CommandPalette";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useSse } from "@/realtime/useSse";
import Projects from "./pages/Projects";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import HiveGraph from "./pages/HiveGraph";
import ChatCentral from "./pages/ChatCentral";
import CodeVersioning from "./pages/CodeVersioning";
import Insights from "./pages/Insights";
import SpecPlan from "./pages/SpecPlan";
import Modules from "./pages/Modules";
import ModuleDetail from "./pages/ModuleDetail";
import Settings from "./pages/Settings";
import AgentForge from "./pages/AgentForge";
import SessionHistory from "./pages/SessionHistory";
import NotFound from "./pages/NotFound";
import Stats from "./pages/Stats";
import Planning from "./pages/Planning";
import Forge from "./pages/Forge";

const queryClient = new QueryClient();

function RealtimeBridge() {
  useSse();
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <WorkspaceProvider>
        <TooltipProvider>
          <ErrorBoundary>
            <RealtimeBridge />
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

                  {/* Phase 5+6 redesign: new top-level routes */}
                  <Route path="/stats" element={<Stats />} />
                  <Route path="/planning" element={<Planning />} />
                  <Route path="/forge" element={<Forge />} />

                  {/* Backwards-compat redirects so deep links keep working
                      while the new IA stabilises. The `replace` flag means
                      browser back skips the redirect step. */}
                  <Route path="/insights" element={<Navigate to="/stats" replace />} />
                  <Route path="/spec" element={<Navigate to="/planning" replace />} />
                  <Route path="/modules" element={<Navigate to="/forge?tab=modules" replace />} />
                  <Route path="/agent-forge" element={<Navigate to="/forge?tab=agents" replace />} />

                  {/* Legacy concrete pages still mounted for the redesigned
                      tabs to lazy-load (Stats wraps Insights, Forge wraps
                      Modules + AgentForge). Kept as direct routes too so
                      detail pages and existing tests still resolve. */}
                  <Route path="/insights-legacy" element={<Insights />} />
                  <Route path="/spec-legacy" element={<SpecPlan />} />
                  <Route path="/modules-legacy" element={<Modules />} />
                  <Route path="/modules/:moduleId" element={<ModuleDetail />} />
                  <Route path="/agent-forge-legacy" element={<AgentForge />} />

                  <Route path="/settings" element={<Settings />} />
                  <Route path="/session-history" element={<SessionHistory />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </ErrorBoundary>
        </TooltipProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
