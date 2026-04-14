import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Package, ArrowLeft, Download, Star, Layers, Check, GitBranch, FileText, Clock, AlertTriangle, Bot } from 'lucide-react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

const moduleDetails: Record<string, {
  id: string; name: string; version: string; author: string; description: string; longDescription: string;
  stars: number; downloads: string; category: string; status: 'installed' | 'available';
  layers: { name: string; files: number; lines: number; description: string }[];
  dependencies: { name: string; version: string; required: boolean }[];
  changelog: { version: string; date: string; changes: string[] }[];
  screenshots: string[];
}> = {
  'hcm-auth': {
    id: 'hcm-auth', name: 'Auth Module', version: '2.1.0', author: 'HIVE Core Team',
    description: 'JWT authentication with refresh tokens and session management',
    longDescription: 'A comprehensive authentication module for HIVE agents that provides JWT-based authentication with automatic refresh token rotation, session management, rate limiting, and multi-provider OAuth support. Built for security-first agent operations with audit logging and anomaly detection.',
    stars: 342, downloads: '12.4K', category: 'Core', status: 'installed',
    layers: [
      { name: 'Interface', files: 4, lines: 280, description: 'Public API surface — login, logout, refresh, validate' },
      { name: 'Logic', files: 6, lines: 520, description: 'Token generation, validation, rotation, and session tracking' },
      { name: 'Storage', files: 3, lines: 190, description: 'Session store adapters: Redis, PostgreSQL, in-memory' },
      { name: 'Events', files: 2, lines: 85, description: 'Auth lifecycle events: login, logout, token_refresh, anomaly' },
      { name: 'Tests', files: 8, lines: 640, description: 'Unit + integration tests with 94% coverage' },
    ],
    dependencies: [
      { name: 'jsonwebtoken', version: '^9.0.0', required: true },
      { name: 'bcryptjs', version: '^2.4.3', required: true },
      { name: 'redis', version: '^4.6.0', required: false },
    ],
    changelog: [
      { version: '2.1.0', date: 'Apr 11, 2026', changes: ['Added OAuth provider support', 'Fixed token rotation race condition', 'Improved audit logging'] },
      { version: '2.0.0', date: 'Mar 28, 2026', changes: ['Breaking: New session store API', 'RS256 key rotation', 'Rate limiting per user'] },
      { version: '1.5.2', date: 'Mar 15, 2026', changes: ['Patched XSS in redirect URI', 'Performance improvements'] },
    ],
    screenshots: [],
  },
  'hcm-db': {
    id: 'hcm-db', name: 'Database ORM', version: '3.0.1', author: 'HIVE Core Team',
    description: 'Type-safe database queries with auto-migrations and seeding',
    longDescription: 'A fully type-safe ORM built for HIVE agent workflows. Supports automatic schema migrations, seed data generation, query optimization hints, and multi-tenant isolation. Agents can generate and execute database operations with confidence through compile-time type checking.',
    stars: 567, downloads: '28.1K', category: 'Core', status: 'installed',
    layers: [
      { name: 'Interface', files: 5, lines: 340, description: 'Query builder, model definitions, and migration API' },
      { name: 'Logic', files: 8, lines: 780, description: 'Query compilation, optimization, and execution engine' },
      { name: 'Storage', files: 4, lines: 310, description: 'Database adapters: PostgreSQL, SQLite, MySQL' },
      { name: 'Migrations', files: 3, lines: 220, description: 'Auto-migration engine with rollback support' },
      { name: 'Tests', files: 12, lines: 920, description: 'Comprehensive test suite with 91% coverage' },
    ],
    dependencies: [
      { name: 'pg', version: '^8.11.0', required: true },
      { name: 'better-sqlite3', version: '^9.0.0', required: false },
      { name: 'zod', version: '^3.22.0', required: true },
    ],
    changelog: [
      { version: '3.0.1', date: 'Apr 7, 2026', changes: ['Fixed connection pooling leak', 'Added query timing logs'] },
      { version: '3.0.0', date: 'Mar 20, 2026', changes: ['Breaking: Zod-based schema definitions', 'Multi-tenant support', 'Query plan visualization'] },
    ],
    screenshots: [],
  },
};

// Fallback for unknown modules
const fallbackModule = {
  id: 'unknown', name: 'Unknown Module', version: '0.0.0', author: 'Unknown',
  description: 'Module not found', longDescription: '', stars: 0, downloads: '0',
  category: 'Unknown', status: 'available' as const, layers: [], dependencies: [], changelog: [], screenshots: [],
};

export default function ModuleDetail() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const mod = moduleDetails[moduleId ?? ''] ?? fallbackModule;
  const [tab, setTab] = useState<'overview' | 'layers' | 'deps' | 'changelog'>('overview');
  const [installDialogOpen, setInstallDialogOpen] = useState(false);

  const handleInstall = () => {
    setInstallDialogOpen(false);
    toast.success(`${mod.name} v${mod.version} installed`);
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/modules')} className="text-muted-foreground hover:text-foreground mt-1"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <Package className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">{mod.name}</h1>
            <span className="text-micro font-mono text-muted-foreground bg-surface-2 px-2 py-0.5 rounded">v{mod.version}</span>
            <span className="text-micro bg-surface-2 px-2 py-0.5 rounded text-muted-foreground">{mod.category}</span>
          </div>
          <p className="text-sm text-muted-foreground">{mod.description}</p>
          <div className="flex items-center gap-4 mt-2 text-micro text-muted-foreground">
            <span className="flex items-center gap-1"><Star className="h-3 w-3" />{mod.stars}</span>
            <span className="flex items-center gap-1"><Download className="h-3 w-3" />{mod.downloads}</span>
            <span>by {mod.author}</span>
          </div>
        </div>
        {mod.status === 'installed' ? (
          <span className="text-xs text-success bg-success/10 px-3 py-1.5 rounded-md flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Installed</span>
        ) : (
          <button onClick={() => setInstallDialogOpen(true)} className="text-xs text-primary-foreground bg-primary px-3 py-1.5 rounded-md hover:bg-primary/90">Install</button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['overview', 'layers', 'deps', 'changelog'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 text-xs capitalize border-b-2 transition-colors', tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t === 'deps' ? 'Dependencies' : t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'overview' && (
        <div className="space-y-4 max-w-2xl">
          <p className="text-sm text-muted-foreground leading-relaxed">{mod.longDescription}</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <span className="text-micro text-muted-foreground">Layers</span>
              <span className="block text-lg font-semibold font-mono mt-1">{mod.layers.length}</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <span className="text-micro text-muted-foreground">Total Files</span>
              <span className="block text-lg font-semibold font-mono mt-1">{mod.layers.reduce((s: number, l) => s + l.files, 0)}</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <span className="text-micro text-muted-foreground">Total Lines</span>
              <span className="block text-lg font-semibold font-mono mt-1">{mod.layers.reduce((s: number, l) => s + l.lines, 0).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'layers' && (
        <div className="space-y-3 max-w-2xl">
          {mod.layers.map((layer, i) => (
            <motion.div key={layer.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Layer {i + 1}: {layer.name}</span>
                </div>
                <div className="flex gap-3 text-micro text-muted-foreground font-mono">
                  <span>{layer.files} files</span>
                  <span>{layer.lines} lines</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{layer.description}</p>
            </motion.div>
          ))}
        </div>
      )}

      {tab === 'deps' && (
        <div className="max-w-xl">
          <div className="rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left px-4 py-2">Package</th><th className="text-left px-4 py-2">Version</th><th className="text-left px-4 py-2">Required</th></tr></thead>
              <tbody className="divide-y divide-border">
                {mod.dependencies.map(dep => (
                  <tr key={dep.name} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2 font-mono">{dep.name}</td>
                    <td className="px-4 py-2 font-mono text-muted-foreground">{dep.version}</td>
                    <td className="px-4 py-2">{dep.required ? <span className="text-primary">Required</span> : <span className="text-muted-foreground">Optional</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'changelog' && (
        <div className="max-w-xl space-y-4">
          {mod.changelog.map((entry, i) => (
            <div key={entry.version} className="relative pl-6">
              <div className="absolute left-0 top-1 flex flex-col items-center">
                <div className={cn('h-3 w-3 rounded-full border-2', i === 0 ? 'border-primary bg-primary/20' : 'border-border bg-surface-2')} />
                {i < mod.changelog.length - 1 && <div className="w-px h-full bg-border mt-1" />}
              </div>
              <div className="pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold">v{entry.version}</span>
                  <span className="text-micro text-muted-foreground">{entry.date}</span>
                </div>
                <ul className="space-y-1">
                  {entry.changes.map(c => (
                    <li key={c} className="text-xs text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>{c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Install confirmation dialog */}
      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle>Install {mod.name}?</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3 text-sm text-muted-foreground">
            <p>This will add <span className="font-mono text-foreground">{mod.name} v{mod.version}</span> to your project.</p>
            {mod.dependencies.filter(d => d.required).length > 0 && (
              <div className="rounded-md border border-border bg-surface-2 p-3">
                <span className="text-micro font-semibold text-foreground block mb-1">Required dependencies:</span>
                {mod.dependencies.filter(d => d.required).map(d => (
                  <span key={d.name} className="text-micro font-mono block">{d.name} {d.version}</span>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <button onClick={() => setInstallDialogOpen(false)} className="rounded-md border border-border px-3 py-2 text-xs">Cancel</button>
            <button onClick={handleInstall} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground hover:bg-primary/90">Install</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
