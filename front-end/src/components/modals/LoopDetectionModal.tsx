import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertTriangle, Pause, RotateCcw, Play } from 'lucide-react';
import { toast } from 'sonner';

interface LoopDetectionModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly agentName?: string;
}

export function LoopDetectionModal({ open, onOpenChange, agentName = 'Doc Writer' }: LoopDetectionModalProps) {
  const loopActions = [
    { time: '01:15:30', action: 'Attempted to write API types section' },
    { time: '01:16:12', action: 'Attempted to write API types section' },
    { time: '01:16:58', action: 'Attempted to write API types section' },
    { time: '01:17:40', action: 'Attempted to write API types section' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Loop Detected — {agentName}
          </DialogTitle>
          <DialogDescription>This agent has repeated the same action {loopActions.length} times without progress</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
            <h4 className="text-xs font-semibold text-warning mb-2">Repeated Actions</h4>
            <div className="space-y-1">
              {loopActions.map((a) => (
                <div key={a.time} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground w-16">{a.time}</span>
                  <span className="text-muted-foreground">{a.action}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            <strong>Probable cause:</strong> Missing dependency — waiting on API type definitions from Backend Engineer.
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button onClick={() => { toast.info(`${agentName} paused`); onOpenChange(false); }} className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            <Pause className="h-3.5 w-3.5" /> Pause Agent
          </button>
          <button onClick={() => { toast.info(`${agentName} task reset and restarted`); onOpenChange(false); }} className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" /> Reset Task
          </button>
          <button onClick={() => { toast.success(`${agentName} restarted with new context`); onOpenChange(false); }} className="flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90">
            <Play className="h-3.5 w-3.5" /> Restart
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
