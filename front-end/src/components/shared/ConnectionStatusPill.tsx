import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { cn } from "@/lib/utils";

/**
 * Realtime connection indicator for the TopBar. Replaces the silent
 * `console.warn("[sse] connection closed by server")` so a dropped SSE
 * stream is visible to the user instead of buried in the console.
 */
export function ConnectionStatusPill({ className }: { readonly className?: string }) {
  const { connectionState, reconnectCount } = useRealtime();

  // "Live" (when connected) is intentionally muted so it doesn't compete
  // with the session-active green or the primary CTA. The pill only goes
  // loud when something is wrong (connecting / offline) — that's when the
  // operator needs to see it. Renamed from "Live" to "Online" to avoid
  // implying that a project session is running (which is a different state).
  const config = {
    open: {
      icon: <Wifi className="h-3 w-3" />,
      label: "Online",
      color: "text-muted-foreground border-border/40 bg-transparent",
      title: reconnectCount > 0 ? `Reconnected (${reconnectCount}× since load)` : "Realtime stream connected",
    },
    connecting: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      label: "Connecting",
      color: "text-warning border-warning/30 bg-warning/5",
      title: "Reconnecting to realtime stream…",
    },
    closed: {
      icon: <WifiOff className="h-3 w-3" />,
      label: "Offline",
      color: "text-destructive border-destructive/30 bg-destructive/5",
      title: "Realtime stream disconnected — live updates paused",
    },
  }[connectionState];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        config.color,
        className,
      )}
      title={config.title}
    >
      {config.icon}
      <span className="hidden sm:inline">{config.label}</span>
    </span>
  );
}
