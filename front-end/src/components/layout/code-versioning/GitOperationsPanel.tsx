import { cn } from '@/lib/utils';
import { GitCommit, Github, RefreshCw, Send, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface GitOperationsPanelProps {
  readonly commitMessage: string;
  readonly onCommitMessageChange: (msg: string) => void;
  readonly onCommit: () => void;
  readonly onPush: () => void;
  readonly onSync: () => void;
  readonly isPending: boolean;
  readonly progress?: number;
}

export function GitOperationsPanel({ commitMessage, onCommitMessageChange, onCommit, onPush, onSync, isPending, progress }: GitOperationsPanelProps) {
  return (
    <div className="p-4 space-y-4 border-t border-border bg-card">
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Commit Message</label>
        <textarea value={commitMessage} onChange={(e) => onCommitMessageChange(e.target.value)}
          placeholder="Describe your changes..." className="w-full h-20 rounded-md border border-border bg-surface-2 p-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none scrollbar-thin" />
      </div>
      <div className="flex flex-col gap-2">
        <button onClick={onCommit} disabled={isPending || !commitMessage.trim()}
          className="flex items-center justify-center gap-2 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommit className="h-3.5 w-3.5" />}
          Commit Changes
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onPush} disabled={isPending}
            className="flex items-center justify-center gap-2 rounded-md border border-border bg-surface-2 py-2 text-xs font-medium hover:bg-surface-3 transition-colors disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> Push
          </button>
          <button onClick={onSync} disabled={isPending}
            className="flex items-center justify-center gap-2 rounded-md border border-border bg-surface-2 py-2 text-xs font-medium hover:bg-surface-3 transition-colors disabled:opacity-50">
            <RefreshCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} /> Sync
          </button>
        </div>
      </div>
      {isPending && progress !== undefined && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-micro text-muted-foreground">
            <span>Operation in progress...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-1" />
        </div>
      )}
    </div>
  );
}
