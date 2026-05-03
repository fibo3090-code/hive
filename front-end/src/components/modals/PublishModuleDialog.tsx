import { useEffect, useMemo, useState } from 'react';
import { Loader2, Globe, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useProjectSynthesisJobs,
  usePublishModule,
  useUnpublishModule,
  type ModuleVisibility,
  type SynthesisJob,
} from '@/api/synthesis';

interface PublishModuleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Active project — required to list completed jobs. */
  readonly projectId: string | null | undefined;
  /** When set, the dialog skips the job picker and publishes that job. */
  readonly jobId?: string | null;
}

const isCompleted = (status: string) =>
  status === 'completed' || status === 'complete' || status === 'succeeded';

export function PublishModuleDialog({
  open,
  onOpenChange,
  projectId,
  jobId: presetJobId,
}: PublishModuleDialogProps) {
  const jobsQuery = useProjectSynthesisJobs(projectId);
  const publish = usePublishModule();
  const unpublish = useUnpublishModule();

  const [jobId, setJobId] = useState<string | null>(presetJobId ?? null);
  const [visibility, setVisibility] = useState<ModuleVisibility>('project');
  const [summary, setSummary] = useState('');

  // Reset state whenever the dialog opens or the preset changes.
  useEffect(() => {
    if (open) {
      setJobId(presetJobId ?? null);
      setVisibility('project');
      setSummary('');
    }
  }, [open, presetJobId]);

  const candidateJobs = useMemo<SynthesisJob[]>(() => {
    const jobs = jobsQuery.data ?? [];
    return jobs.filter((job) => isCompleted(job.status));
  }, [jobsQuery.data]);

  const selectedJob = candidateJobs.find((job) => job.id === jobId) ?? null;

  // Pre-fill summary from the synthesis description on first job select.
  useEffect(() => {
    if (selectedJob && summary.length === 0) {
      setSummary(selectedJob.description.slice(0, 240));
    }
  }, [selectedJob, summary.length]);

  const onSubmit = async () => {
    if (!jobId) {
      toast.error('Pick a completed module to publish');
      return;
    }
    try {
      await publish.mutateAsync({
        jobId,
        visibility,
        summary: summary.trim() || undefined,
      });
      toast.success(`Module published (${visibility})`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Publish failed');
    }
  };

  const onUnpublish = async () => {
    if (!selectedJob || !selectedJob.publishedAt) return;
    try {
      await unpublish.mutateAsync(selectedJob.id);
      toast.success('Module unpublished');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unpublish failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Publish module</DialogTitle>
          <DialogDescription>
            Make a synthesised module discoverable in the catalog. Project
            visibility limits to projects in the same sovereignty tier;
            public visibility shares across tiers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Job picker — hidden when a preset jobId is supplied. */}
          {!presetJobId && (
            <div>
              <label className="text-xs font-medium mb-1 block">
                Completed module
              </label>
              {jobsQuery.isLoading ? (
                <div className="text-xs text-muted-foreground">Loading…</div>
              ) : candidateJobs.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  No completed synthesis jobs in this project. Synthesise a
                  module first.
                </div>
              ) : (
                <select
                  value={jobId ?? ''}
                  onChange={(e) => setJobId(e.target.value || null)}
                  className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm"
                >
                  <option value="">— pick a module —</option>
                  {candidateJobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.description.slice(0, 60)}
                      {job.publishedAt ? ' · already published' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Visibility */}
          <div>
            <label className="text-xs font-medium mb-2 block">
              Visibility
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    value: 'project' as const,
                    label: 'Project',
                    desc: 'Same tier only',
                    icon: Lock,
                  },
                  {
                    value: 'public' as const,
                    label: 'Public',
                    desc: 'All projects',
                    icon: Globe,
                  },
                ]
              ).map((opt) => {
                const selected = visibility === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVisibility(opt.value)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition',
                      selected
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/30',
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <opt.icon className="h-3.5 w-3.5" /> {opt.label}
                    </div>
                    <div className="text-micro text-muted-foreground">
                      {opt.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div>
            <label className="text-xs font-medium mb-1 block">
              Summary{' '}
              <span className="text-muted-foreground font-normal">
                (optional, defaults to the synthesis description)
              </span>
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={400}
              rows={3}
              placeholder="A one-line pitch for this module."
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm resize-none"
            />
            <div className="text-micro text-muted-foreground mt-1">
              {summary.length}/400
            </div>
          </div>

          {selectedJob?.publishedAt && (
            <div className="rounded-md border border-info/30 bg-info/5 p-3 text-xs">
              Already published as{' '}
              <span className="font-mono">
                {selectedJob.publishedVisibility}
              </span>{' '}
              on {new Date(selectedJob.publishedAt).toLocaleString()}.
              Republishing will update the visibility and summary.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          {selectedJob?.publishedAt && (
            <button
              type="button"
              onClick={() => void onUnpublish()}
              disabled={unpublish.isPending}
              className="rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {unpublish.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Unpublish'
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={publish.isPending || !jobId}
            className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {publish.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {selectedJob?.publishedAt ? 'Update' : 'Publish'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
