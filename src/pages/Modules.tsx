import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Boxes, Download, Star, Package, Cpu, Search, Plus, ChevronRight, ChevronDown, Layers, Check, Loader2, X, Settings, Eye } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';

const mockModules = [
  { id: 'hcm-auth', name: 'Auth Module', version: '2.1.0', status: 'installed' as const, category: 'Core', description: 'JWT authentication with refresh tokens and session management', stars: 342, downloads: '12.4K', layers: ['Interface', 'Logic', 'Storage', 'Events', 'Tests'], author: 'HIVE Core Team', updated: '3 days ago' },
  { id: 'hcm-db', name: 'Database ORM', version: '3.0.1', status: 'installed' as const, category: 'Core', description: 'Type-safe database queries with auto-migrations and seeding', stars: 567, downloads: '28.1K', layers: ['Interface', 'Logic', 'Storage', 'Migrations', 'Tests'], author: 'HIVE Core Team', updated: '1 week ago' },
  { id: 'hcm-eval', name: 'Eval Engine', version: '1.4.0', status: 'installed' as const, category: 'Core', description: 'Agent output evaluation, scoring, and quality tracking', stars: 234, downloads: '8.9K', layers: ['Interface', 'Logic', 'Scoring', 'Events', 'Tests'], author: 'HIVE Core Team', updated: '2 weeks ago' },
  { id: 'hcm-deploy', name: 'Deploy Pipeline', version: '1.2.0', status: 'available' as const, category: 'Community', description: 'CI/CD pipeline with preview deployments, rollbacks, and canary releases', stars: 189, downloads: '5.2K', layers: ['Interface', 'Logic', 'CI/CD', 'Events'], author: 'DevOps Guild', updated: '5 days ago' },
  { id: 'hcm-monitor', name: 'Performance Monitor', version: '0.9.0', status: 'available' as const, category: 'Community', description: 'Real-time performance metrics, alerts, and anomaly detection', stars: 145, downloads: '3.1K', layers: ['Interface', 'Logic', 'Metrics', 'Alerts'], author: 'Observability Lab', updated: '1 week ago' },
  { id: 'hcm-i18n', name: 'i18n Module', version: '1.0.0', status: 'available' as const, category: 'Community', description: 'Internationalization with automatic translation and locale management', stars: 98, downloads: '2.0K', layers: ['Interface', 'Logic', 'Storage'], author: 'Community', updated: '2 weeks ago' },
  { id: 'hcm-cache', name: 'Smart Cache', version: '0.5.0', status: 'available' as const, category: 'Community', description: 'Intelligent caching layer with TTL, invalidation, and warm-up strategies', stars: 76, downloads: '1.5K', layers: ['Interface', 'Logic', 'Storage'], author: 'Performance Guild', updated: '3 weeks ago' },
];

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
  const [category, setCategory] = useState('All');
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [showSynthesizer, setShowSynthesizer] = useState(false);
  const [synthStep, setSynthStep] = useState(0);
  const [synthRunning, setSynthRunning] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = mockModules.filter(m => {
    const catMatch = category === 'All' ? true : category === 'Installed' ? m.status === 'installed' : m.category === category;
    const searchMatch = search === '' || m.name.toLowerCase().includes(search.toLowerCase()) || m.description.toLowerCase().includes(search.toLowerCase());
    return catMatch && searchMatch;
  });

  const startSynth = () => {
    setSynthRunning(true);
    setSynthStep(0);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      setSynthStep(step);
      if (step >= synthesizerSteps.length) {
        clearInterval(interval);
        setSynthRunning(false);
      }
    }, 1200);
  };

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border py-2">
        {categories.map(c => (
          <button key={c} onClick={() => { setCategory(c); setShowSynthesizer(c === 'Synthesizer'); }}
            className={cn('flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors',
              (c === 'Synthesizer' ? showSynthesizer : category === c && !showSynthesizer) ? 'bg-primary/10 text-primary border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {c === 'Synthesizer' && <Cpu className="h-3.5 w-3.5" />}
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 animate-fade-in">
        {showSynthesizer ? (
          <div className="max-w-xl space-y-6">
            <h2 className="text-lg font-semibold">Module Synthesizer</h2>
            <p className="text-sm text-muted-foreground">Describe the module you need and HIVE will generate it using the 8-step pipeline.</p>
            <textarea className="w-full rounded-lg border border-border bg-card p-3 text-sm placeholder:text-muted-foreground resize-none h-24" placeholder="Describe the module you want to create..." />
            <button onClick={startSynth} disabled={synthRunning} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {synthRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
              {synthRunning ? 'Synthesizing...' : 'Synthesize Module'}
            </button>
            {(synthRunning || synthStep > 0) && (
              <div className="space-y-2">
                <Progress value={(synthStep / synthesizerSteps.length) * 100} className="h-2" />
                {synthesizerSteps.map((step, i) => (
                  <div key={i} className={cn('flex items-center gap-2 text-xs transition-all', i < synthStep ? 'text-success' : i === synthStep && synthRunning ? 'text-foreground' : 'text-muted-foreground/40')}>
                    {i < synthStep ? <Check className="h-3.5 w-3.5" /> : i === synthStep && synthRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <div className="h-3.5 w-3.5" />}
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
                <input value={search} onChange={e => setSearch(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-card pl-9 pr-4 text-sm placeholder:text-muted-foreground" placeholder="Search modules..." />
              </div>
              <button className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20">
                <Plus className="h-3.5 w-3.5" /> Publish Module
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {filtered.map(mod => (
                <div key={mod.id} className="rounded-lg border border-border bg-card hover:border-primary/30 cursor-pointer transition-colors overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-primary" />
                        <div>
                          <h3 className="text-sm font-semibold">{mod.name}</h3>
                          <span className="text-micro font-mono text-muted-foreground">v{mod.version}</span>
                        </div>
                      </div>
                      {mod.status === 'installed' ? (
                        <span className="text-micro text-success bg-success/10 px-2 py-0.5 rounded-full">Installed</span>
                      ) : (
                        <button className="text-micro text-primary bg-primary/10 px-2 py-0.5 rounded-full hover:bg-primary/20">Install</button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{mod.description}</p>
                    <div className="flex items-center gap-4 text-micro text-muted-foreground mb-2">
                      <span className="flex items-center gap-1"><Star className="h-3 w-3" />{mod.stars}</span>
                      <span className="flex items-center gap-1"><Download className="h-3 w-3" />{mod.downloads}</span>
                      <span className="bg-surface-2 px-1.5 py-0.5 rounded text-micro">{mod.category}</span>
                    </div>
                    <div className="flex items-center justify-between text-micro text-muted-foreground">
                      <span>by {mod.author}</span>
                      <span>Updated {mod.updated}</span>
                    </div>
                  </div>

                  {/* Layer expansion */}
                  <button onClick={() => setExpandedModule(expandedModule === mod.id ? null : mod.id)} className="flex items-center gap-1 w-full px-4 py-2 text-micro text-muted-foreground hover:text-foreground border-t border-border">
                    <Layers className="h-3 w-3" /> {mod.layers.length} layers
                    {expandedModule === mod.id ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
                  </button>
                  <AnimatePresence>
                    {expandedModule === mod.id && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="px-4 pb-3 space-y-1">
                          {mod.layers.map((layer, i) => (
                            <div key={layer} className="flex items-center gap-2 text-micro">
                              <div className="h-1 w-1 rounded-full bg-primary" />
                              <span className="text-muted-foreground">Layer {i + 1}:</span>
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
          </>
        )}
      </div>
    </div>
  );
}
