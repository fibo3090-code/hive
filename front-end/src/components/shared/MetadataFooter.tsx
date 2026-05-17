import { cn, formatCents } from "@/lib/utils";

interface MetadataFooterProps {
  readonly model?: string | null;
  readonly providerId?: string | null;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly costCents?: number;
  readonly durationMs?: number;
  readonly timestamp?: string;
  readonly status?: "streaming" | "complete" | "cancelled" | "error" | "pending" | "done";
  readonly className?: string;
}

/**
 * Compact metadata row rendered under every assistant message bubble.
 * Honesty rule (R7 from the UI audit): tokens/cost/model/duration MUST be
 * visible per message — otherwise users can't debug cost or quality.
 */
export function MetadataFooter({
  model,
  providerId,
  tokensIn,
  tokensOut,
  costCents,
  durationMs,
  timestamp,
  status,
  className,
}: MetadataFooterProps) {
  const totalTokens = (tokensIn ?? 0) + (tokensOut ?? 0);
  const hasTokens = totalTokens > 0;
  const hasCost = (costCents ?? 0) > 0;
  const hasDuration = (durationMs ?? 0) > 0;
  const hasModel = Boolean(model);

  const statusBadge = (() => {
    switch (status) {
      case "streaming":
      case "pending":
        return <span className="text-micro text-primary">streaming…</span>;
      case "cancelled":
        return <span className="text-micro text-warning">cancelled</span>;
      case "error":
        return <span className="text-micro text-destructive">error</span>;
      default:
        return null;
    }
  })();

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground font-mono", className)}>
      {timestamp && <span>{new Date(timestamp).toLocaleTimeString(undefined, { hour12: false })}</span>}
      {hasModel && (
        <span title={providerId ? `Provider: ${providerId}` : undefined}>
          {providerId ? `${providerId} · ` : ""}
          {model}
        </span>
      )}
      {hasTokens && (
        <span title={`Input: ${tokensIn ?? 0} · Output: ${tokensOut ?? 0}`}>
          {totalTokens} tok
        </span>
      )}
      {hasCost && <span>{formatCents(costCents)}</span>}
      {hasDuration && <span>{(durationMs! / 1000).toFixed(2)}s</span>}
      {statusBadge}
    </div>
  );
}
