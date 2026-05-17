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

  const config = {
    open: {
      icon: <Wifi className="h-3 w-3" />,
      label: "Live",
      color: "text-success border-success/30 bg-success/5",
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
