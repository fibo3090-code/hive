import { cn } from '@/lib/utils';
import { ChevronRight, ChevronDown, FileCode, Folder, CheckSquare, Square } from 'lucide-react';
import type { GitFile } from '@/types/domain';

interface GitFileTreeProps {
  readonly files: GitFile[];
  readonly selectedFile: string | null;
  readonly onSelectFile: (path: string) => void;
  readonly onToggleStage: (path: string) => void;
}

export function GitFileTree({ files, selectedFile, onSelectFile, onToggleStage }: GitFileTreeProps) {
  return (
    <div className="flex-1 overflow-auto scrollbar-thin py-2">
      {files.map((file) => (
        <div key={file.path} onClick={() => onSelectFile(file.path)}
          className={cn('group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors', selectedFile === file.path ? 'bg-primary/10 text-primary' : 'hover:bg-surface-2')}>
          <button onClick={(e) => { e.stopPropagation(); onToggleStage(file.path); }} className="text-muted-foreground hover:text-primary">
            {file.staged ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <FileCode className={cn('h-4 w-4 shrink-0', file.status === 'added' ? 'text-success' : file.status === 'deleted' ? 'text-destructive' : 'text-warning')} />
          <span className="text-xs truncate flex-1">{file.path}</span>
          <span className={cn('text-[10px] font-bold uppercase opacity-0 group-hover:opacity-100', file.status === 'added' ? 'text-success' : file.status === 'deleted' ? 'text-destructive' : 'text-warning')}>{file.status[0]}</span>
        </div>
      ))}
    </div>
  );
}
