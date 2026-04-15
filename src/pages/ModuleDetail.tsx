import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ArrowLeft, Check, Download, Layers, Package, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useHiveData } from '@/api/queries/useHiveData';
import { useInstallModule, useModuleData } from '@/api/queries/useServerData';
import type { ModuleCatalogItem, ModuleChangelogEntry, ModuleDependency } from '@/types/domain';
import { toast } from 'sonner';

const fallbackModule: ModuleCatalogItem = {
  id: 'unknown',
  name: 'Unknown Module',
  version: '0.0.0',
  author: 'Unknown',
  description: 'Module not found',
  longDescription: 'This module is not available in the backend catalog.',
  stars: 0,
  downloads: '0',
  category: 'Unknown',
  status: 'available',
  layers: [],
  dependencies: [],
  changelog: [],
};

export default function ModuleDetail() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const { activeProject } = useHiveData();
  const moduleQuery = useModuleData(moduleId);
  const installModule = useInstallModule(activeProject?.id);
  const mod = moduleQuery.data ?? fallbackModule;
  const [tab, setTab] = useState<'overview' | 'layers' | 'deps' | 'changelog'>('overview');
  const [installDialogOpen, setInstallDialogOpen] = useState(false);

  const handleInstall = async () => {
    setInstallDialogOpen(false);
    if (!moduleId) return;

    try {
      await installModule.mutateAsync(moduleId);
      toast.success(`${mod.name} v${mod.version} installed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to install module');
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/modules')} className="text-muted-foreground hover:text-foreground mt-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <Package className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">{mod.name}</h1>
            <span className="text-micro font-mono text-muted-foreground bg-surface-2 px-2 py-0.5 rounded">v{mod.version}</span>
            <span className="text-micro bg-surface-2 px-2 py-0.5 rounded text-muted-foreground">{mod.category}</span>
          </div>
          <p className="text-sm text-muted-foreground">{mod.description}</p>
          <div className="flex items-center gap-4 mt-2 text-micro text-muted-foreground">
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" />
              {mod.stars}
            </span>
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {mod.downloads}
            </span>
            <span>by {mod.author}</span>
          </div>
        </div>
        {mod.status === 'installed' ? (
          <span className="text-xs text-success bg-success/10 px-3 py-1.5 rounded-md flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Installed
          </span>
        ) : (
          <button
            onClick={() => setInstallDialogOpen(true)}
            className="text-xs text-primary-foreground bg-primary px-3 py-1.5 rounded-md hover:bg-primary/90"
          >
            Install
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['overview', 'layers', 'deps', 'changelog'] as const).map((section) => (
          <button
            key={section}
            onClick={() => setTab(section)}
            className={cn(
              'px-4 py-2 text-xs capitalize border-b-2 transition-colors',
              tab === section ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {section === 'deps' ? 'Dependencies' : section}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4 max-w-2xl">
          <p className="text-sm text-muted-foreground leading-relaxed">{mod.longDescription}</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Layers', value: String(mod.layers?.length ?? 0) },
              { label: 'Dependencies', value: String(mod.dependencies?.length ?? 0) },
              { label: 'Changelog Entries', value: String(mod.changelog?.length ?? 0) },
            ].map((tile) => (
              <div key={tile.label} className="rounded-lg border border-border bg-card p-3">
                <span className="text-micro text-muted-foreground">{tile.label}</span>
                <span className="block text-lg font-semibold font-mono mt-1">{tile.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'layers' && (
        <div className="space-y-3 max-w-2xl">
          {(mod.layers ?? []).map((layer: string, index: number) => {
            const layerName = layer;
            const layerDescription = 'Generated module layer';
            const fileCount = null;
            const lineCount = null;
            return (
              <motion.div
                key={`${layerName}-${index}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">
                      Layer {index + 1}: {layerName}
                    </span>
                  </div>
                  {(fileCount !== null || lineCount !== null) && (
                    <div className="flex gap-3 text-micro text-muted-foreground font-mono">
                      {fileCount !== null && <span>{fileCount} files</span>}
                      {lineCount !== null && <span>{lineCount} lines</span>}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{layerDescription}</p>
              </motion.div>
            );
          })}
        </div>
      )}

      {tab === 'deps' && (
        <div className="max-w-xl">
          <div className="rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-2">Package</th>
                  <th className="text-left px-4 py-2">Version</th>
                  <th className="text-left px-4 py-2">Required</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(mod.dependencies ?? []).map((dependency: ModuleDependency) => (
                  <tr key={dependency.name} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2 font-mono">{dependency.name}</td>
                    <td className="px-4 py-2 font-mono text-muted-foreground">{dependency.version ?? '—'}</td>
                    <td className="px-4 py-2">
                      {dependency.required ? (
                        <span className="text-primary">Required</span>
                      ) : (
                        <span className="text-muted-foreground">Optional</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'changelog' && (
        <div className="max-w-xl space-y-4">
          {(mod.changelog ?? []).map((entry: ModuleChangelogEntry, index: number) => (
            <div key={`${entry.version}-${entry.date}`} className="relative pl-6">
              <div className="absolute left-0 top-1 flex flex-col items-center">
                <div className={cn('h-3 w-3 rounded-full border-2', index === 0 ? 'border-primary bg-primary/20' : 'border-border bg-surface-2')} />
                {index < mod.changelog.length - 1 && <div className="w-px h-full bg-border mt-1" />}
              </div>
              <div className="pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold">v{entry.version}</span>
                  <span className="text-micro text-muted-foreground">{entry.date}</span>
                </div>
                <ul className="space-y-1">
                  {(entry.changes ?? []).map((change: string) => (
                    <li key={change} className="text-xs text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle>Install {mod.name}?</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3 text-sm text-muted-foreground">
            <p>
              This will add <span className="font-mono text-foreground">{mod.name} v{mod.version}</span> to your project.
            </p>
            {(mod.dependencies ?? []).filter((dependency: ModuleDependency) => dependency.required).length > 0 && (
              <div className="rounded-md border border-border bg-surface-2 p-3">
                <span className="text-micro font-semibold text-foreground block mb-1">Required dependencies:</span>
                {(mod.dependencies ?? [])
                  .filter((dependency: ModuleDependency) => dependency.required)
                  .map((dependency: ModuleDependency) => (
                    <span key={dependency.name} className="text-micro font-mono block">
                      {dependency.name} {dependency.version}
                    </span>
                  ))}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setInstallDialogOpen(false)} className="rounded-md border border-border px-3 py-2 text-xs">
              Cancel
            </button>
            <button onClick={() => void handleInstall()} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground hover:bg-primary/90">
              Install
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
