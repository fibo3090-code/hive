import React from "react";
import { AlertTriangle, RefreshCw, Copy, Check } from "lucide-react";
import { logger } from "@/lib/logger";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
}

interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly fallback?: React.ReactNode;
  /** Friendly name for the section being wrapped — shown in the fallback. */
  readonly scope?: string;
}

/**
 * Per-route error boundary. App-level boundary catches the catastrophic
 * cases; each `<Route>` wraps its element with another instance so one
 * page crashing doesn't blank the whole shell.
 *
 * Fallback shows:
 *  - the error message + scope
 *  - dev-only: full stack trace
 *  - prod: Copy diagnostics button (so users can paste an actionable bug report)
 *  - Try again + Reload page
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, copied: false };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error("error-boundary", this.props.scope ?? "anonymous", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, copied: false });
  };

  handleCopy = () => {
    const diagnostics = [
      `[HIVE error report]`,
      `scope: ${this.props.scope ?? "anonymous"}`,
      `time: ${new Date().toISOString()}`,
      `url: ${window.location.href}`,
      `userAgent: ${navigator.userAgent}`,
      ``,
      `message: ${this.state.error?.message ?? "(no message)"}`,
      ``,
      `stack:`,
      this.state.error?.stack ?? "(no stack)",
    ].join("\n");
    void navigator.clipboard.writeText(diagnostics).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1500);
    });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isDev = import.meta.env.DEV;
      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center max-w-2xl mx-auto">
          <div className="rounded-full bg-destructive/10 p-4 mb-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="text-sm font-semibold mb-1">
            {this.props.scope ? `${this.props.scope} crashed` : "Something went wrong"}
          </h3>
          <p className="text-xs text-muted-foreground max-w-md mb-4">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          {isDev && this.state.error?.stack && (
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface-2 p-3 text-left text-[11px] font-mono text-muted-foreground mb-4 w-full">
              {this.state.error.stack}
            </pre>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-foreground hover:bg-surface-2 transition-colors"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
            >
              {this.state.copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {this.state.copied ? "Copied" : "Copy diagnostics"}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
