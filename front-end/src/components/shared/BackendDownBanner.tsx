import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ServerOff, RefreshCw } from "lucide-react";
import { useRealtime } from "@/realtime/RealtimeProvider";

/**
 * Single global banner replacing the per-query "Failed to fetch" toast storm.
 *
 * Detection: counts consecutive failed queries via the TanStack QueryCache
 * observer. ≥3 failures while the SSE stream is also closed → backend is
 * down. As soon as anything succeeds, the banner clears.
 */
export function BackendDownBanner() {
  const qc = useQueryClient();
  const { connectionState } = useRealtime();
  const [recentFailures, setRecentFailures] = useState(0);

  useEffect(() => {
    const cache = qc.getQueryCache();
    return cache.subscribe((event) => {
      if (event.type !== "updated") return;
      const action = event.action;
      if (action.type === "error") {
        setRecentFailures((n) => n + 1);
      } else if (action.type === "success") {
        setRecentFailures(0);
      }
    });
  }, [qc]);

  const down = recentFailures >= 3 && connectionState !== "open";

  if (!down) return null;

  return (
    <div className="flex items-center justify-center gap-3 bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-xs text-destructive">
      <ServerOff className="h-4 w-4 shrink-0" />
      <span className="font-medium">Backend unreachable</span>
      <span className="text-destructive/80 hidden sm:inline">
        — make sure <code className="rounded bg-destructive/10 px-1 font-mono">hive-api serve</code> is running on{" "}
        <code className="rounded bg-destructive/10 px-1 font-mono">127.0.0.1:8787</code>. Retrying automatically…
      </span>
      <button
        type="button"
        onClick={() => {
          setRecentFailures(0);
          // C486: a keyless invalidateQueries() marks every cached query
          // stale — after the backend comes back that meant a full refetch
          // storm and losing still-good cached data. Only the queries that
          // actually failed need a retry.
          qc.invalidateQueries({
            predicate: (query) => query.state.status === "error",
          });
        }}
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-medium hover:bg-destructive/20"
      >
        <RefreshCw className="h-3 w-3" /> Retry now
      </button>
    </div>
  );
}
