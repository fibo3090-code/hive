import { cn } from '@/lib/utils';
import { FileCode, CheckSquare, Square } from 'lucide-react';

export interface GitFileEntry {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted' | string;
  readonly staged: boolean;
}

interface GitFileTreeProps {
  readonly files: GitFileEntry[];
  readonly selectedFile: string | null;
  readonly onSelectFile: (path: string) => void;
  readonly onToggleStage: (path: string) => void;
}

export function GitFileTree({ files, selectedFile, onSelectFile, onToggleStage }: GitFileTreeProps) {
  return (
    <div className="flex-1 overflow-auto scrollbar-thin py-2">
      {files.map((file) => (
        // C511/C512: file rows are buttons (keyboard-reachable, announced as
        // interactive), the stage toggle carries an aria-label, and the
        // status letter shows on focus as well as hover.
        <div key={file.path}
          className={cn('group flex items-center gap-2 px-3 py-1.5 transition-colors focus-within:bg-surface-2', selectedFile === file.path ? 'bg-primary/10 text-primary' : 'hover:bg-surface-2')}>
          <button
            type="button"
            onClick={() => onToggleStage(file.path)}
            aria-label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
            aria-pressed={file.staged}
            className="text-muted-foreground hover:text-primary"
          >
            {file.staged ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onSelectFile(file.path)}
            className="flex flex-1 items-center gap-2 text-left cursor-pointer min-w-0"
          >
            <FileCode className={cn('h-4 w-4 shrink-0', file.status === 'added' ? 'text-success' : file.status === 'deleted' ? 'text-destructive' : 'text-warning')} />
            <span className="text-xs truncate flex-1">{file.path}</span>
            <span className={cn('text-[10px] font-bold uppercase opacity-0 group-hover:opacity-100 group-focus-within:opacity-100', file.status === 'added' ? 'text-success' : file.status === 'deleted' ? 'text-destructive' : 'text-warning')}>{file.status[0]}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
