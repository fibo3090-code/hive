import { cn } from '@/lib/utils';
import { FileCode, Plus, Minus, Edit3, Trash2 } from 'lucide-react';

interface WorkingTreeStatusProps {
  readonly stagedFiles: number;
  readonly modifiedFiles: number;
  readonly insertions: number;
  readonly deletions: number;
}

export function WorkingTreeStatus({ stagedFiles, modifiedFiles, insertions, deletions }: WorkingTreeStatusProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1.5">
        <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{stagedFiles + modifiedFiles} files changed</span>
      </div>
      <div className="flex items-center gap-3 border-l border-border pl-4">
        <div className="flex items-center gap-1 text-[10px] font-mono text-success">
          <Plus className="h-2.5 w-2.5" /> {insertions}
        </div>
        <div className="flex items-center gap-1 text-[10px] font-mono text-destructive">
          <Minus className="h-2.5 w-2.5" /> {deletions}
        </div>
      </div>
    </div>
  );
}
