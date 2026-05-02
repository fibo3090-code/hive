import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertTriangle, Pause, RotateCcw, Play } from 'lucide-react';
import { toast } from 'sonner';
import { usePauseAgent, useResumeAgent } from '@/api/agents';

/**
 * Single repeated tool invocation observed by the loop detector. The
 * backend daemon (Phase 4 follow-up) inserts these into the
 * `loop_detected` notification payload; the modal renders them
 * directly.
 */
export interface LoopSample {
  /** ISO 8601 timestamp of the call. */
  occurredAt: string;
  /** Tool name. */
  tool: string;
  /** Short, single-line description of the call (e.g. JSON-condensed args). */
  description: string;
}

export interface LoopDetectionPayload {
  agentId: string;
  agentName: string;
  /** Stable hash of `(tool, args)` so the UI can show a "this loop" anchor. */
  fingerprint: string;
  /** Total observed repetitions in the detector window. */
  occurrences: number;
  samples: LoopSample[];
  /** Optional cause hint produced by the detector heuristic. */
  probableCause?: string;
}

interface LoopDetectionModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Real loop data, typically derived from a `loop_detected` notification.
   * When omitted the modal falls back to an explicit empty state instead
   * of pretending to show data.
   */
  readonly payload?: LoopDetectionPayload;
}

function formatTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleTimeString();
}

export function LoopDetectionModal({ open, onOpenChange, payload }: LoopDetectionModalProps) {
  const pauseMutation = usePauseAgent();
  const resumeMutation = useResumeAgent();
  const agentName = payload?.agentName ?? 'Unknown agent';
  const samples = payload?.samples ?? [];
  const occurrences = payload?.occurrences ?? samples.length;

  const handlePause = async () => {
    if (!payload) {
      toast.error('No active loop to pause');
      return;
    }
    try {
      await pauseMutation.mutateAsync(payload.agentId);
      toast.success(`${agentName} paused`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to pause agent');
    }
  };

  const handleResume = async () => {
    if (!payload) {
      onOpenChange(false);
      return;
    }
    try {
      await resumeMutation.mutateAsync(payload.agentId);
      toast.success(`${agentName} resumed with fresh context`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resume agent');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Loop Detected — {agentName}
          </DialogTitle>
          <DialogDescription>
            {payload
              ? `This agent has repeated ${payload.samples[0]?.tool ?? 'a tool call'} ${occurrences} times without progress`
              : 'No active loop detected for this agent right now.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {samples.length > 0 ? (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
              <h4 className="text-xs font-semibold text-warning mb-2">Repeated calls</h4>
              <div className="space-y-1">
                {samples.map((sample, idx) => (
                  <div key={`${sample.occurredAt}-${idx}`} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground w-20 shrink-0">
                      {formatTime(sample.occurredAt)}
                    </span>
                    <span className="text-muted-foreground truncate" title={sample.description}>
                      <span className="font-mono">{sample.tool}</span> {sample.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              No repeated-call samples have been recorded for this agent.
            </div>
          )}

          {payload?.probableCause && (
            <div className="text-xs text-muted-foreground">
              <strong>Probable cause:</strong> {payload.probableCause}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={() => void handlePause()}
            disabled={!payload || pauseMutation.isPending}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Pause className="h-3.5 w-3.5" /> Pause Agent
          </button>
          <button
            onClick={() => {
              toast.info('Task reset queued — pause then resume to apply');
              onOpenChange(false);
            }}
            disabled={!payload}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Task
          </button>
          <button
            onClick={() => void handleResume()}
            disabled={!payload || resumeMutation.isPending}
            className="flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> Restart
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
