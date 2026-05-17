import { useMemo, useState } from "react";
import { Copy, Check, ChevronRight, ChevronDown, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonViewerProps {
  readonly value: unknown;
  /** Show first N chars by default; rest behind "expand". */
  readonly previewChars?: number;
  /** Optional label rendered above the JSON. */
  readonly label?: string;
  readonly className?: string;
}

/**
 * Collapsible / truncated JSON viewer with copy. Replaces raw
 * `<pre>{JSON.stringify(x, null, 2)}</pre>` dumps that were filling chat
 * bubbles with hundreds of unreadable lines.
 */
export function JsonViewer({ value, previewChars = 320, label, className }: JsonViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(true);

  const pretty = useMemo(() => {
    if (value === undefined) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  if (pretty === "") return null;

  const shouldTruncate = pretty.length > previewChars;
  const display = !expanded && shouldTruncate ? pretty.slice(0, previewChars) + "\n…" : pretty;

  const copy = () => {
    void navigator.clipboard.writeText(pretty).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className={cn("rounded-md border border-border bg-surface-2 overflow-hidden", className)}>
      <div className="flex items-center gap-1 px-2 py-1 bg-surface-3 border-b border-border">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <span className="text-micro font-mono text-muted-foreground flex-1 truncate">
          {label ?? "json"} · {pretty.length} chars
        </span>
        {shouldTruncate && open && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground p-0.5"
            aria-label={expanded ? "Collapse content" : "Expand content"}
            title={expanded ? "Show less" : "Show all"}
          >
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          className="text-muted-foreground hover:text-foreground p-0.5"
          aria-label="Copy JSON"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      {open && (
        <pre className="p-2 text-micro font-mono leading-relaxed overflow-x-auto scrollbar-thin whitespace-pre-wrap break-all text-foreground/80 max-h-80">
          {display}
        </pre>
      )}
    </div>
  );
}
