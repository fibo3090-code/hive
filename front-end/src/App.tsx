import { lazy, Suspense } from "react";
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
import { BackendDownBanner } from "@/components/shared/BackendDownBanner";
import { KeyboardShortcutsOverlay } from "@/components/shared/KeyboardShortcutsOverlay";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import { RealtimeProvider } from "@/realtime/RealtimeProvider";
import { useSse } from "@/realtime/useSse";

// Lazy-loaded routes — keeps the initial bundle small. The first-load
// JS shrinks from ~1.5 MB (all routes statically imported) to a few
// hundred KB; the per-route chunk loads when the user navigates there.
// `manualChunks` in vite.config.ts groups the big runtime deps
// (recharts, reactflow, monaco, framer-motion) into their own chunks so
// they're shared across the lazy pages that use them.
const Projects = lazy(() => import("./pages/Projects"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const HiveGraph = lazy(() => import("./pages/HiveGraph"));
const ChatCentral = lazy(() => import("./pages/ChatCentral"));
const CodeVersioning = lazy(() => import("./pages/CodeVersioning"));
const Settings = lazy(() => import("./pages/Settings"));
const SessionHistory = lazy(() => import("./pages/SessionHistory"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Stats = lazy(() => import("./pages/Stats"));
const Planning = lazy(() => import("./pages/Planning"));
const Forge = lazy(() => import("./pages/Forge"));
const SpawnRequests = lazy(() => import("./pages/SpawnRequests"));

const queryClient = new QueryClient();

function RealtimeBridge() {
  useSse();
  return null;
}

/**
 * Per-route error + suspense wrapper. An exception in any one page no
 * longer takes down the whole app; the user lands on a friendly fallback
 * with a Reload button, and the rest of the navigation tree keeps
 * working. Suspense fallback uses the shared shimmer skeleton.
 */
function Page({ name, children }: { readonly name: string; readonly children: React.ReactNode }) {
  return (
    <ErrorBoundary scope={name}>
      <Suspense fallback={<LoadingSkeleton variant="page" />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <WorkspaceProvider>
        <TooltipProvider>
          <RealtimeProvider>
            <ErrorBoundary scope="App">
              <RealtimeBridge />
              <Toaster />
              <Sonner />
              <BackendDownBanner />
              <BrowserRouter>
                <CommandPalette />
                <KeyboardShortcutsOverlay />
                <Routes>
                  {/* Full-screen routes (no chrome) */}
                  <Route path="/" element={<Page name="Projects"><Projects /></Page>} />
                  <Route path="/onboarding" element={<Page name="Onboarding"><Onboarding /></Page>} />

                  {/* App routes with sidebar + top bar */}
                  <Route element={<AppLayout />}>
                    <Route path="/dashboard" element={<Page name="Dashboard"><Dashboard /></Page>} />
                    <Route path="/hive-graph" element={<Page name="HiveGraph"><HiveGraph /></Page>} />
                    <Route path="/chat" element={<Page name="ChatCentral"><ChatCentral /></Page>} />
                    <Route path="/code" element={<Page name="CodeVersioning"><CodeVersioning /></Page>} />

                    {/* Phase 5+6 redesign: new top-level routes */}
                    <Route path="/stats" element={<Page name="Stats"><Stats /></Page>} />
                    <Route path="/planning" element={<Page name="Planning"><Planning /></Page>} />
                    <Route path="/forge" element={<Page name="Forge"><Forge /></Page>} />
                    <Route path="/spawn-requests" element={<Page name="SpawnRequests"><SpawnRequests /></Page>} />

                    {/* Backwards-compat redirects so deep links keep working
                        while the new IA stabilises. The `replace` flag means
                        browser back skips the redirect step. The `*-legacy`
                        slugs were dropped in this PR per plan §C15. */}
                    <Route path="/insights" element={<Navigate to="/stats" replace />} />
                    <Route path="/spec" element={<Navigate to="/planning" replace />} />
                    <Route path="/modules" element={<Navigate to="/forge?tab=modules" replace />} />
                    <Route path="/agent-forge" element={<Navigate to="/forge?tab=agents" replace />} />

                    <Route path="/settings" element={<Page name="Settings"><Settings /></Page>} />
                    <Route path="/session-history" element={<Page name="SessionHistory"><SessionHistory /></Page>} />
                  </Route>

                  <Route path="*" element={<Page name="NotFound"><NotFound /></Page>} />
                </Routes>
              </BrowserRouter>
            </ErrorBoundary>
          </RealtimeProvider>
        </TooltipProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
