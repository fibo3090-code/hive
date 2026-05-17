import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type DateFormatMode = "relative" | "datetime" | "date" | "time";

/**
 * Single source of truth for date formatting across the UI. Replaces the
 * scattered mix of `new Date(iso).toLocaleString()`, ad-hoc date-fns calls,
 * and raw ISO strings rendered to the user.
 *
 * - `relative` → "5 minutes ago" / "in 2 hours"
 * - `datetime` → "May 17, 2026, 19:28"
 * - `date`     → "May 17, 2026"
 * - `time`     → "19:28:04"
 */
export function formatDate(iso: string | null | undefined, mode: DateFormatMode = "datetime"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  switch (mode) {
    case "relative":
      return formatDistanceToNow(d, { addSuffix: true });
    case "date":
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    case "time":
      return d.toLocaleTimeString(undefined, { hour12: false });
    case "datetime":
    default:
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
  }
}

/** Cents → "$1.23" (4 decimals if very small). */
export function formatCents(cents: number | null | undefined): string {
  const c = cents ?? 0;
  return `$${(c / 100).toFixed(c > 0 && c < 100 ? 4 : 2)}`;
}

/** Bytes → "1.2 MB" / "42 KB" / "12 B". */
export function formatBytes(bytes: number | null | undefined): string {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
