import { useMemo, useState, type MouseEvent } from 'react';
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
import type { ModuleCatalogItem } from '@/types/domain';
import { toast } from 'sonner';

const categories = ['All', 'Installed', 'Core', 'Community', 'Project', 'Synthesizer'];
const synthesizerSteps = [
  'Analyzing requirements',
  'Generating interface layer',
  'Building logic layer',
  'Creating storage layer',
  'Adding event handlers',
  'Writing tests',
  'Running eval',
  'Packaging module',
];

export default function Modules() {
  const navigate = useNavigate();
  const { activeProject } = useHiveData();
  const modulesQuery = useModulesData(activeProject?.id);
  const installModule = useInstallModule(activeProject?.id);
  const [category, setCategory] = useState('All');
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [showSynthesizer, setShowSynthesizer] = useState(false);
  const [synthStep, setSynthStep] = useState(0);
  const [synthRunning, setSynthRunning] = useState(false);
  const [search, setSearch] = useState('');

  const modules = useMemo<ModuleCatalogItem[]>(() => modulesQuery.data ?? [], [modulesQuery.data]);
  const filtered = useMemo(() => {
    return modules.filter((module: ModuleCatalogItem) => {
      const categoryMatch =
        category === 'All'
          ? true
          : category === 'Installed'
            ? module.status === 'installed'
            : module.category === category;
      const searchMatch =
        search === '' ||
        module.name?.toLowerCase().includes(search.toLowerCase()) ||
        module.description?.toLowerCase().includes(search.toLowerCase());
      return categoryMatch && searchMatch;
    });
  }, [category, modules, search]);

  const startSynth = () => {
    setSynthRunning(true);
    setSynthStep(0);
    let step = 0;
    const interval = window.setInterval(() => {
      step += 1;
      setSynthStep(step);
      if (step >= synthesizerSteps.length) {
        window.clearInterval(interval);
        setSynthRunning(false);
      }
    }, 900);
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

  return (
    <div className="flex h-full">
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
              (item === 'Synthesizer' ? showSynthesizer : category === item && !showSynthesizer)
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
          <div className="max-w-xl space-y-6">
            <h2 className="text-lg font-semibold">Module Synthesizer</h2>
            <p className="text-sm text-muted-foreground">
              This flow is intentionally UI-only for now. Installed and available modules come from the backend catalog,
              while synthesis remains a guided placeholder until orchestration lands.
            </p>
            <textarea
              className="w-full rounded-lg border border-border bg-card p-3 text-sm placeholder:text-muted-foreground resize-none h-24"
              placeholder="Describe the module you want to create..."
            />
            <button
              onClick={startSynth}
              disabled={synthRunning}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {synthRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
              {synthRunning ? 'Synthesizing...' : 'Synthesize Module'}
            </button>
            {(synthRunning || synthStep > 0) && (
              <div className="space-y-2">
                <Progress value={(synthStep / synthesizerSteps.length) * 100} className="h-2" />
                {synthesizerSteps.map((step, index) => (
                  <div
                    key={step}
                    className={cn(
                      'flex items-center gap-2 text-xs transition-all',
                      index < synthStep
                        ? 'text-success'
                        : index === synthStep && synthRunning
                          ? 'text-foreground'
                          : 'text-muted-foreground/40'
                    )}
                  >
                    {index < synthStep ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : index === synthStep && synthRunning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <div className="h-3.5 w-3.5" />
                    )}
                    {step}
                  </div>
                ))}
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
              <button className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20">
                <Plus className="h-3.5 w-3.5" /> Publish Module
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {filtered.map((module: ModuleCatalogItem) => (
                <div
                  key={module.id}
                  onClick={() => navigate(`/modules/${module.id}`)}
                  className="rounded-lg border border-border bg-card hover:border-primary/30 cursor-pointer transition-colors overflow-hidden"
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
                          onClick={(event) => void handleInstall(event, module.id)}
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
                  </div>

                  <button
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
