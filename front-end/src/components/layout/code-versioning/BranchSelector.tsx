import { cn } from '@/lib/utils';
import { GitBranch, ChevronDown, Check } from 'lucide-react';

interface BranchSelectorProps {
  readonly currentBranch: string;
  readonly branches: string[];
  readonly onBranchChange: (branch: string) => void;
}

export function BranchSelector({ currentBranch, branches, onBranchChange }: BranchSelectorProps) {
  return (
    <div className="relative group">
      <button className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs font-medium hover:bg-surface-2 transition-colors">
        <GitBranch className="h-3.5 w-3.5 text-primary" />
        <span className="truncate max-w-[120px]">{currentBranch}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      <div className="absolute top-full left-0 mt-1 w-48 rounded-md border border-border bg-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50 py-1">
        <div className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Switch Branch</div>
        {branches.map((branch) => (
          <button key={branch} onClick={() => onBranchChange(branch)}
            className={cn('flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-surface-2 transition-colors', branch === currentBranch && 'text-primary bg-primary/5 font-medium')}>
            {branch}
            {branch === currentBranch && <Check className="h-3 w-3" />}
          </button>
        ))}
      </div>
    </div>
  );
}
