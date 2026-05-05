import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  Layers,
  Loader2,
  Package,
  Plus,
  Search,
  Star,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';
import { useHiveData } from '@/api/queries/useHiveData';
import { useInstallModule, useModulesData } from '@/api/queries/useServerData';
import { useStartSynthesis, useSynthesisJob } from '@/api/synthesis';
import { eventStreamUrl } from '@/api/client';
import { PublishModuleDialog } from '@/components/modals/PublishModuleDialog';
import type { ModuleCatalogItem } from '@/types/domain';
import { toast } from 'sonner';
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';
import { useWorkspace } from '@/context/WorkspaceContext';

const categories = ['All', 'Installed', 'Core', 'Community', 'Project', 'Synthesizer'];

type ProgressEvent = {
  step: number;
  total: number;
  logLine: string;
};

export default function Modules() {
  const navigate = useNavigate();
  const { activeProject } = useHiveData();
  const { defaultModel } = useWorkspace();
  const modulesQuery = useModulesData(activeProject?.id);
  const installModule = useInstallModule(activeProject?.id);
  const startSynthesis = useStartSynthesis(activeProject?.id);
  const [category, setCategory] = useState('All');
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [showSynthesizer, setShowSynthesizer] = useState(false);
  const [search, setSearch] = useState('');
  const [description, setDescription] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(defaultModel);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishJobId, setPublishJobId] = useState<string | null>(null);
  const jobQuery = useSynthesisJob(jobId);

  const modules = useMemo<ModuleCatalogItem[]>(() => modulesQuery.data ?? [], [modulesQuery.data]);
  const filtered = useMemo(() => {
    return modules.filter((module: ModuleCatalogItem) => {
      const categoryMatchIfNotAll = category === 'Installed' ? module.status === 'installed' : module.category === category;
      const categoryMatch = category === 'All' ? true : categoryMatchIfNotAll;
      const searchMatch =
        search === '' ||
        module.name?.toLowerCase().includes(search.toLowerCase()) ||
        module.description?.toLowerCase().includes(search.toLowerCase());
      return categoryMatch && searchMatch;
    });
  }, [category, modules, search]);

  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(eventStreamUrl('/v1/events'));

    const onProgress = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { jobId: string; step: number; total: number; logLine: string };
        if (data.jobId !== jobId) return;
        setProgress((current) => [...current, { step: data.step, total: data.total, logLine: data.logLine }]);
      } catch {
        // ignore malformed events
      }
    };

    const onComplete = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { jobId: string; moduleId: string };
        if (data.jobId !== jobId) return;
        toast.success('Module synthesis complete');
        navigate(`/modules/${data.moduleId}`);
      } catch {
        // ignore malformed events
      }
    };

    const onError = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { jobId: string; error: string };
        if (data.jobId !== jobId) return;
        toast.error(data.error);
      } catch {
        // ignore malformed events
      }
    };

    source.addEventListener(`synthesis.${jobId}.progress`, onProgress as EventListener);
    source.addEventListener(`synthesis.${jobId}.complete`, onComplete as EventListener);
    source.addEventListener(`synthesis.${jobId}.error`, onError as EventListener);

    return () => source.close();
  }, [jobId, navigate]);

  useEffect(() => {
    if (jobQuery.data?.status === 'error' && jobQuery.data.error) {
      toast.error(jobQuery.data.error);
    }
  }, [jobQuery.data?.error, jobQuery.data?.status]);

  const startSynth = async () => {
    if (!description.trim()) {
      toast.error('Describe the module first');
      return;
    }
    try {
      setProgress([]);
      const result = await startSynthesis.mutateAsync({
        description: description.trim(),
        tier: activeProject?.sovereigntyTier ?? null,
        model: selectedModel,
      });
      setJobId(result.jobId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to synthesize module');
    }
  };

  const handleInstall = async (event: MouseEvent, moduleId: string) => {
    event.stopPropagation();

    try {
      await installModule.mutateAsync(moduleId);
      toast.success('Module installed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to install module');
    }
  };

  const currentProgress = progress.length > 0 ? progress[progress.length - 1] : undefined;
  const progressValue = currentProgress ? (currentProgress.step / currentProgress.total) * 100 : 0;

  return (
    <div className="flex h-full">
      <PublishModuleDialog
        open={publishOpen}
        onOpenChange={(o) => {
          setPublishOpen(o);
          if (!o) setPublishJobId(null);
        }}
        projectId={activeProject?.id}
        jobId={publishJobId}
      />
      <div className="w-48 border-r border-border py-2">
        {categories.map((item) => (
          <button
            key={item}
            onClick={() => {
              setCategory(item);
              setShowSynthesizer(item === 'Synthesizer');
            }}
            className={cn(
              'flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors',
              (() => {
                if (item === 'Synthesizer') return showSynthesizer;
                return category === item && !showSynthesizer;
              })()
                ? 'bg-primary/10 text-primary border-r-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {item === 'Synthesizer' && <Cpu className="h-3.5 w-3.5" />}
            {item}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 animate-fade-in">
        {showSynthesizer ? (
          <div className="max-w-2xl space-y-6">
            <h2 className="text-lg font-semibold">Module Synthesizer</h2>
            <p className="text-sm text-muted-foreground">
              Generate a project module into the real workspace, commit it, and stream progress back into HIVE.
            </p>
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 p-3 text-sm placeholder:text-muted-foreground resize-none h-28"
                placeholder="Describe the module you want to create..."
              />
              <div className="max-w-md">
                <div className="mb-2 text-xs font-medium">Model Override</div>
                <ModelPicker value={selectedModel} onChange={setSelectedModel} />
              </div>
              <button
                onClick={() => void startSynth()}
                disabled={startSynthesis.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {startSynthesis.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                {startSynthesis.isPending ? 'Starting…' : 'Synthesize Module'}
              </button>
            </div>

            {(jobId || progress.length > 0) && (
              <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Synthesis Progress</div>
                    <div className="text-xs text-muted-foreground">Job {jobId ?? 'pending'}</div>
                  </div>
                  <div className="text-xs text-muted-foreground uppercase">{jobQuery.data?.status ?? 'queued'}</div>
                </div>
                <Progress value={progressValue} className="h-2" />
                <div className="space-y-2">
                  {progress.map((item, index) => (
                    <div key={`${item.step}-${index}`} className="flex items-center gap-2 text-xs">
                      {index === progress.length - 1 && jobQuery.data?.status !== 'completed' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-success" />}
                      <span>{item.logLine}</span>
                    </div>
                  ))}
                  {jobQuery.data?.error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                      {jobQuery.data.error}
                    </div>
                  )}
                </div>
                {Array.isArray(jobQuery.data?.generatedFilesJson) && jobQuery.data!.generatedFilesJson.length > 0 && (
                  <div className="space-y-1 rounded-md border border-border bg-surface-2 p-3">
                    <div className="text-xs font-medium">Generated Files</div>
                    {jobQuery.data!.generatedFilesJson.map((file) => (
                      <div key={file} className="font-mono text-micro text-muted-foreground">{file}</div>
                    ))}
                  </div>
                )}
                {/* Publish action surfaces the moment the job completes — */}
                {/* preview the generated files first, then publish in one click. */}
                {jobQuery.data && (jobQuery.data.status === 'completed' || jobQuery.data.status === 'complete' || jobQuery.data.status === 'succeeded') && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPublishJobId(jobQuery.data!.id);
                        setPublishOpen(true);
                      }}
                      className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      {jobQuery.data.publishedAt ? 'Update publication' : 'Publish to catalog'}
                    </button>
                    {jobQuery.data.publishedAt && (
                      <span className="text-xs text-success">
                        Published · {jobQuery.data.publishedVisibility}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full h-9 rounded-lg border border-border bg-card pl-9 pr-4 text-sm placeholder:text-muted-foreground"
                  placeholder="Search modules..."
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setPublishJobId(null);
                  setPublishOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20"
              >
                <Plus className="h-3.5 w-3.5" /> Publish Module
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {filtered.map((module: ModuleCatalogItem) => (
                <div
                  key={module.id}
                  className="rounded-lg border border-border bg-card hover:border-primary/30 transition-colors overflow-hidden"
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-primary" />
                        <div>
                          <h3 className="text-sm font-semibold">{module.name}</h3>
                          <span className="text-micro font-mono text-muted-foreground">v{module.version}</span>
                        </div>
                      </div>
                      {module.status === 'installed' ? (
                        <span className="text-micro text-success bg-success/10 px-2 py-0.5 rounded-full">Installed</span>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); void handleInstall(event, module.id); }}
                          className="text-micro text-primary bg-primary/10 px-2 py-0.5 rounded-full hover:bg-primary/20"
                        >
                          {installModule.isPending ? 'Installing' : 'Install'}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{module.description}</p>
                    <div className="flex items-center gap-4 text-micro text-muted-foreground mb-2">
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3" />
                        {module.stars}
                      </span>
                      <span className="flex items-center gap-1">
                        <Download className="h-3 w-3" />
                        {module.downloads}
                      </span>
                      <span className="bg-surface-2 px-1.5 py-0.5 rounded text-micro">{module.category}</span>
                    </div>
                    <div className="flex items-center justify-between text-micro text-muted-foreground">
                      <span>by {module.author}</span>
                      <span>Updated {module.updated}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/modules/${module.id}`)}
                      aria-label={`Open ${module.name}`}
                      className="mt-2 text-micro text-primary hover:underline"
                    >
                      View details →
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedModule(expandedModule === module.id ? null : module.id);
                    }}
                    className="flex items-center gap-1 w-full px-4 py-2 text-micro text-muted-foreground hover:text-foreground border-t border-border"
                  >
                    <Layers className="h-3 w-3" /> {module.layers?.length ?? 0} layers
                    {expandedModule === module.id ? (
                      <ChevronDown className="h-3 w-3 ml-auto" />
                    ) : (
                      <ChevronRight className="h-3 w-3 ml-auto" />
                    )}
                  </button>

                  <AnimatePresence>
                    {expandedModule === module.id && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="px-4 pb-3 space-y-1">
                          {(module.layers ?? []).map((layer: string, index: number) => (
                            <div key={layer} className="flex items-center gap-2 text-micro">
                              <div className="h-1 w-1 rounded-full bg-primary" />
                              <span className="text-muted-foreground">Layer {index + 1}:</span>
                              <span>{layer}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-card/60 p-8 text-center mt-4">
                <h3 className="text-sm font-semibold mb-1">No modules found</h3>
                <p className="text-xs text-muted-foreground">
                  Try a different search or switch categories to browse the backend catalog.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
