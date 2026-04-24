import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Settings as SettingsIcon, Cpu, GitBranch, Github, Link2,
  Shield, Bell, Keyboard, Palette, Database, Info, Plug, FileLock, Wrench,
  Plus, Trash2, Check, Save, RefreshCw, Loader2,
} from 'lucide-react';
import { useLlmProviders, useSetProviderKey, useTestProvider, type LlmProvider } from '@/api/llm';
import { useInitWorkspace, useWorkspaceInfo } from '@/api/tools';
import { ModelPicker } from '@/components/shared/ModelPicker';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { defaultSettings, useWorkspace, type SettingsState } from '@/context/WorkspaceContext';
import type { ModelSelection } from '@/components/shared/ModelPicker';
import { useHiveData } from '@/api/queries/useHiveData';
import { useSettingsData } from '@/api/queries/useServerData';
import { toast } from 'sonner';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';

const settingsNav = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'llm', label: 'LLM Providers', icon: Cpu },
  { id: 'router', label: 'Adaptive Router', icon: Cpu },
  { id: 'tools', label: 'Tools & Sandbox', icon: Wrench },
  { id: 'modules', label: 'HCM Modules', icon: Plug },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'github', label: 'GitHub Sync', icon: Github },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
  { id: 'fileprotect', label: 'File Protection', icon: FileLock },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'data', label: 'Data & Privacy', icon: Database },
  { id: 'about', label: 'About', icon: Info },
] as const;

const routingTable = [
  { task: 'Code Generation', model: 'GPT-4o', score: 0.92, cost: '$0.03/1K' },
  { task: 'Code Review', model: 'Claude 3.5 Sonnet', score: 0.95, cost: '$0.015/1K' },
  { task: 'Testing', model: 'Claude 3.5 Sonnet', score: 0.91, cost: '$0.015/1K' },
  { task: 'Documentation', model: 'Gemini Pro', score: 0.88, cost: '$0.007/1K' },
  { task: 'Planning', model: 'GPT-4o', score: 0.94, cost: '$0.03/1K' },
] as const;

const shortcuts = [
  ['⌘K', 'Command Palette'],
  ['⌘1-8', 'Navigate panels'],
  ['⌘⏎', 'Send message'],
  ['⌘.', 'Toggle sidebar'],
  ['⌘/', 'Search files'],
  ['⌘⇧P', 'Pause all agents'],
  ['⌘⇧S', 'Save all'],
  ['⌘B', 'Toggle file tree'],
  ['Esc', 'Close drawer/modal'],
] as const;

function cloneSettings(settings: SettingsState): SettingsState {
  return JSON.parse(JSON.stringify(settings)) as SettingsState;
}

function Row({ label, desc, children }: { readonly label: string; readonly desc: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      {children}
    </div>
  );
}

function Field({
  value,
  onChange,
  className,
  placeholder,
  ...props
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly className?: string;
  readonly placeholder?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'placeholder'>) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn('h-8 rounded-md border border-border bg-surface-2 px-3 text-sm', className)}
      {...props}
    />
  );
}

function SelectField<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  readonly value: T;
  readonly options: readonly T[] | T[];
  readonly onChange: (value: T) => void;
  readonly className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn('h-8 rounded-md border border-border bg-surface-2 px-3 text-sm', className)}
    >
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );
}

export default function Settings() {
  const [section, setSection] = useState<(typeof settingsNav)[number]['id']>('general');
  const { accentPresets } = useWorkspace();
  const { activeProject } = useHiveData();
  const { data: settings, saveSettings } = useSettingsData();
  const [draft, setDraft] = useState<SettingsState>(() => {
    const next = cloneSettings((settings as SettingsState | undefined) ?? defaultSettings);
    if (activeProject) {
      next.general.projectName = activeProject.name;
      next.general.sovereigntyTier = activeProject.sovereigntyTier;
    }
    return next;
  });
  const [pendingFile, setPendingFile] = useState('');

  useEffect(() => {
    if (!settings) return;
    const next = cloneSettings(settings);
    if (activeProject) {
      next.general.projectName = activeProject.name;
      next.general.sovereigntyTier = activeProject.sovereigntyTier;
    }
    setDraft(next);
  }, [activeProject, settings]);

  const baseline = useMemo(() => {
    if (!settings) return draft;
    const next = cloneSettings(settings);
    if (activeProject) {
      next.general.projectName = activeProject.name;
      next.general.sovereigntyTier = activeProject.sovereigntyTier;
    }
    return next;
  }, [activeProject, draft, settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const patch = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    try {
      await saveSettings(draft);
      toast.success('Settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save settings');
    }
  };

  return (
    <div className="flex h-full">
      <div className="w-52 border-r border-border py-2 overflow-auto scrollbar-thin">
        {settingsNav.map((item) => (
          <button
            key={item.id}
            onClick={() => setSection(item.id)}
            className={cn(
              'flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors',
              section === item.id ? 'bg-primary/10 text-primary border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 space-y-6">
        <div className="sticky top-0 z-10 -mx-6 -mt-6 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Settings</h1>
              <p className="text-xs text-muted-foreground">Controlled draft state with persisted save behavior.</p>
            </div>
            <button
              onClick={save}
              disabled={!dirty}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-2 text-xs transition-colors',
                dirty ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-surface-2 text-muted-foreground'
              )}
            >
              <Save className="h-3.5 w-3.5" />
              Save Changes
            </button>
          </div>
        </div>

        {section === 'general' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">General Settings</h2>
            <Row label="Project Name" desc="Display name for the active project">
              <Field value={draft.general.projectName} onChange={(value) => patch('general', { ...draft.general, projectName: value })} className="w-64" />
            </Row>
            <Row label="Auto-save" desc="Automatically save changes">
              <Switch checked={draft.general.autoSave} onCheckedChange={(checked) => patch('general', { ...draft.general, autoSave: checked })} />
            </Row>
            <Row label="Session Timeout" desc="Auto-pause after inactivity (minutes)">
              <div className="flex items-center gap-4">
                <Slider value={[draft.general.sessionTimeout]} onValueChange={([value]) => patch('general', { ...draft.general, sessionTimeout: value })} max={120} step={5} className="w-48" />
                <span className="text-sm font-mono text-primary w-10 text-right">{draft.general.sessionTimeout}</span>
              </div>
            </Row>
            <Row label="Default Sovereignty Tier" desc="Data sovereignty level for new projects">
              <div className="flex gap-1">
                {(['local', 'hybrid', 'cloud'] as const).map((tier) => (
                  <button
                    key={tier}
                    onClick={() => patch('general', { ...draft.general, sovereigntyTier: tier })}
                    className={cn('rounded-md px-3 py-1 text-xs border capitalize', draft.general.sovereigntyTier === tier ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Telemetry" desc="Send anonymous usage data">
              <Switch checked={draft.general.telemetry} onCheckedChange={(checked) => patch('general', { ...draft.general, telemetry: checked })} />
            </Row>
            <Row label="Language" desc="Interface language">
              <SelectField value={draft.general.language} options={['English', 'Deutsch', '日本語']} onChange={(value) => patch('general', { ...draft.general, language: value })} />
            </Row>
            <div className="pt-3">
              <div className="mb-2">
                <div className="text-sm font-medium">Default Model for New Agents</div>
                <div className="text-xs text-muted-foreground">Pre-selected when spawning or forging a new agent</div>
              </div>
              <ModelPicker
                value={draft.defaultModel as ModelSelection | null}
                onChange={(selection) => patch('defaultModel', selection)}
              />
            </div>
          </div>
        )}

        {section === 'llm' && <LlmProvidersSection />}

        {section === 'tools' && <ToolsSandboxSection draft={draft} patch={patch} projectId={activeProject?.id ?? null} />}

        {section === 'router' && (
          <div className="space-y-6 max-w-2xl">
            <h2 className="text-lg font-semibold">Adaptive Router</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-card p-3"><span className="text-micro text-muted-foreground">Routing Mode</span><span className="block text-sm font-semibold mt-1">Multi-Armed Bandit</span></div>
              <div className="rounded-lg border border-border bg-card p-3"><span className="text-micro text-muted-foreground">Exploration Rate</span><span className="block text-sm font-semibold mt-1 font-mono">ε = {(draft.router.explorationRate / 100).toFixed(2)}</span></div>
              <div className="rounded-lg border border-success/30 bg-success/5 p-3"><span className="text-micro text-muted-foreground">Est. Savings</span><span className="block text-sm font-semibold mt-1 text-success font-mono">-23%</span></div>
            </div>
            <div className="rounded-lg border border-border bg-card">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left px-4 py-2">Task Type</th><th className="text-left px-4 py-2">Best Model</th><th className="text-left px-4 py-2">Score</th><th className="text-left px-4 py-2">Cost</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {routingTable.map((row) => <tr key={row.task} className="hover:bg-surface-2/50"><td className="px-4 py-2 font-medium">{row.task}</td><td className="px-4 py-2 font-mono text-muted-foreground">{row.model}</td><td className="px-4 py-2 font-mono text-primary">{row.score}</td><td className="px-4 py-2 font-mono text-muted-foreground">{row.cost}</td></tr>)}
                </tbody>
              </table>
            </div>
            <Row label="Enable Router" desc="Auto-select best model per task"><Switch checked={draft.router.enabled} onCheckedChange={(checked) => patch('router', { ...draft.router, enabled: checked })} /></Row>
            <Row label="Exploration Rate" desc="Probability of trying a non-optimal model">
              <div className="flex items-center gap-4">
                <Slider value={[draft.router.explorationRate]} onValueChange={([value]) => patch('router', { ...draft.router, explorationRate: value })} max={50} step={5} className="w-48" />
                <span className="text-sm font-mono text-primary">{draft.router.explorationRate}%</span>
              </div>
            </Row>
          </div>
        )}

        {section === 'modules' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">HCM Modules</h2>
            {Object.entries(draft.modules).map(([name, enabled]) => <div key={name} className="flex items-center justify-between py-3 border-b border-border"><div><span className="text-sm font-medium">{name}</span><span className="text-micro font-mono text-muted-foreground ml-2">managed</span></div><Switch checked={enabled} onCheckedChange={(checked) => patch('modules', { ...draft.modules, [name]: checked })} /></div>)}
          </div>
        )}

        {section === 'git' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">Git Configuration</h2>
            <Row label="Auto-commit" desc="Automatically commit agent changes"><Switch checked={draft.git.autoCommit} onCheckedChange={(checked) => patch('git', { ...draft.git, autoCommit: checked })} /></Row>
            <Row label="Commit Prefix" desc="Prefix for agent commits"><Field value={draft.git.commitPrefix} onChange={(value) => patch('git', { ...draft.git, commitPrefix: value })} className="w-48 font-mono" /></Row>
            <Row label="Branch Strategy" desc="How to manage branches"><SelectField value={draft.git.branchStrategy} options={['Feature branches', 'Trunk-based', 'Git flow']} onChange={(value) => patch('git', { ...draft.git, branchStrategy: value })} /></Row>
            <Row label="Squash Commits" desc="Squash session commits on merge"><Switch checked={draft.git.squashCommits} onCheckedChange={(checked) => patch('git', { ...draft.git, squashCommits: checked })} /></Row>
          </div>
        )}

        {section === 'github' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">GitHub Sync</h2>
            <div className="rounded-lg border border-success/30 bg-success/5 p-4 flex items-center gap-3"><Check className="h-4 w-4 text-success" /><div><span className="text-sm font-medium text-success">Connected</span><p className="text-xs text-muted-foreground">github.com/org/{(activeProject?.name ?? 'hive-dashboard').toLowerCase().replace(/\s+/g, '-')}</p></div></div>
            <Row label="Auto-push" desc="Push commits to remote automatically"><Switch checked={draft.github.autoPush} onCheckedChange={(checked) => patch('github', { ...draft.github, autoPush: checked })} /></Row>
            <Row label="PR Auto-create" desc="Create PRs for feature branches"><Switch checked={draft.github.autoCreatePr} onCheckedChange={(checked) => patch('github', { ...draft.github, autoCreatePr: checked })} /></Row>
            <Row label="Status Checks" desc="Require CI checks before merge"><Switch checked={draft.github.requireChecks} onCheckedChange={(checked) => patch('github', { ...draft.github, requireChecks: checked })} /></Row>
          </div>
        )}

        {section === 'integrations' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">Integrations</h2>
            {Object.entries(draft.integrations).map(([name, status]) => <div key={name} className="flex items-center justify-between py-3 border-b border-border"><span className="text-sm font-medium">{name}</span><button onClick={() => patch('integrations', { ...draft.integrations, [name]: status === 'connected' ? 'disconnected' : 'connected' })} className={cn('text-micro px-2 py-0.5 rounded-full', status === 'connected' ? 'text-success bg-success/10 hover:bg-success/20' : 'text-primary bg-primary/10 hover:bg-primary/20')}>{status === 'connected' ? 'Connected' : 'Connect'}</button></div>)}
          </div>
        )}

        {section === 'fileprotect' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">File Protection</h2>
            <div className="space-y-2">
              {draft.fileProtection.files.map((filePath) => <div key={filePath} className="flex items-center justify-between py-2 border-b border-border"><span className="text-sm font-mono">{filePath}</span><button onClick={() => patch('fileProtection', { files: draft.fileProtection.files.filter((entry) => entry !== filePath) })} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div>)}
            </div>
            <div className="flex items-center gap-2">
              <Field value={pendingFile} onChange={setPendingFile} placeholder="src/path/to/file.ts" className="flex-1" />
              <button onClick={() => {
                const next = pendingFile.trim();
                if (!next || draft.fileProtection.files.includes(next)) return;
                patch('fileProtection', { files: [...draft.fileProtection.files, next] });
                setPendingFile('');
              }} className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20"><Plus className="h-3.5 w-3.5" />Add</button>
            </div>
          </div>
        )}

        {section === 'security' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">Security & Compliance</h2>
            <Row label="Outbound Prompt Warning" desc="Warn before sending prompts to external APIs"><Switch checked={draft.security.outboundPromptWarning} onCheckedChange={(checked) => patch('security', { ...draft.security, outboundPromptWarning: checked })} /></Row>
            <Row label="API Risk Approval" desc="Require approval for risky API calls"><Switch checked={draft.security.apiRiskApproval} onCheckedChange={(checked) => patch('security', { ...draft.security, apiRiskApproval: checked })} /></Row>
            <Row label="Secret Scanning" desc="Scan code for leaked credentials"><Switch checked={draft.security.secretScanning} onCheckedChange={(checked) => patch('security', { ...draft.security, secretScanning: checked })} /></Row>
            <Row label="Audit Log Retention" desc="How long to keep audit logs"><SelectField value={draft.security.auditLogRetention} options={['30 days', '90 days', '1 year', 'Forever']} onChange={(value) => patch('security', { ...draft.security, auditLogRetention: value })} /></Row>
            <Row label="IP Allowlist" desc="Restrict access to specific IPs"><Switch checked={draft.security.ipAllowlist} onCheckedChange={(checked) => patch('security', { ...draft.security, ipAllowlist: checked })} /></Row>
          </div>
        )}

        {section === 'notifications' && (
          <div className="space-y-6 max-w-2xl">
            <h2 className="text-lg font-semibold">Notifications</h2>
            <div className="rounded-lg border border-border bg-card">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left px-4 py-2">Event</th><th className="text-center px-4 py-2">Email</th><th className="text-center px-4 py-2">Slack</th><th className="text-center px-4 py-2">In-App</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {draft.notifications.map((item, index) => <tr key={item.label}><td className="px-4 py-2 font-medium">{item.label}</td><td className="px-4 py-2 text-center"><Switch checked={item.email} onCheckedChange={(checked) => { const next = [...draft.notifications]; next[index] = { ...item, email: checked }; patch('notifications', next); }} /></td><td className="px-4 py-2 text-center"><Switch checked={item.slack} onCheckedChange={(checked) => { const next = [...draft.notifications]; next[index] = { ...item, slack: checked }; patch('notifications', next); }} /></td><td className="px-4 py-2 text-center"><Switch checked={item.inApp} onCheckedChange={(checked) => { const next = [...draft.notifications]; next[index] = { ...item, inApp: checked }; patch('notifications', next); }} /></td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {section === 'shortcuts' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
            {shortcuts.map(([keys, action]) => <div key={keys} className="flex items-center justify-between py-2 border-b border-border"><span className="text-sm">{action}</span><kbd className="rounded bg-surface-2 px-2 py-0.5 text-xs font-mono text-muted-foreground">{keys}</kbd></div>)}
          </div>
        )}

        {section === 'appearance' && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-lg font-semibold">Appearance</h2>
            <Row label="Theme" desc="UI color scheme">
              <div className="flex gap-2">
                {(['dark', 'light', 'system'] as const).map((theme) => <button key={theme} onClick={() => patch('appearance', { ...draft.appearance, theme })} className={cn('rounded-md px-3 py-1 text-xs border capitalize', draft.appearance.theme === theme ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>{theme}</button>)}
              </div>
            </Row>
            <Row label="Accent Color" desc="Brand color for highlights">
              <div className="flex gap-2">
                {accentPresets.map((preset) => <button key={preset.id} onClick={() => patch('appearance', { ...draft.appearance, accent: preset.id })} className={cn('h-6 w-6 rounded-full border-2', draft.appearance.accent === preset.id ? 'border-foreground scale-110' : 'border-transparent')} style={{ backgroundColor: preset.hex }} title={preset.label} />)}
              </div>
            </Row>
            <Row label="Font Size" desc="Base font size">
              <div className="flex items-center gap-4">
                <Slider value={[draft.appearance.fontSize]} onValueChange={([value]) => patch('appearance', { ...draft.appearance, fontSize: value })} min={12} max={18} step={1} className="w-48" />
                <span className="text-sm font-mono text-primary">{draft.appearance.fontSize}px</span>
              </div>
            </Row>
            <Row label="Reduce Motion" desc="Minimize animations"><Switch checked={draft.appearance.reduceMotion} onCheckedChange={(checked) => patch('appearance', { ...draft.appearance, reduceMotion: checked })} /></Row>
            <Row label="Compact Mode" desc="Reduce spacing between elements"><Switch checked={draft.appearance.compactMode} onCheckedChange={(checked) => patch('appearance', { ...draft.appearance, compactMode: checked })} /></Row>
          </div>
        )}

        {section === 'data' && <DataPrivacySection draft={draft} patch={patch} />}

        {section === 'about' && (
          <div className="space-y-4 max-w-xl">
            <h2 className="text-lg font-semibold">About HIVE</h2>
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-display-sm text-primary mb-2">HIVE v6.0</h3>
              <p className="text-sm text-muted-foreground mb-4">Autonomous Agent Orchestration Platform</p>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Version</span><span className="font-mono">6.0.0-beta</span></div>
                <div className="flex justify-between"><span>Build</span><span className="font-mono">2026.04.12</span></div>
                <div className="flex justify-between"><span>Runtime</span><span className="font-mono">React 18 + Vite 5</span></div>
                <div className="flex justify-between"><span>UI Framework</span><span className="font-mono">Tailwind CSS + shadcn/ui</span></div>
                <div className="flex justify-between"><span>Graph Engine</span><span className="font-mono">React Flow</span></div>
                <div className="flex justify-between"><span>Charts</span><span className="font-mono">Recharts</span></div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4"><h4 className="text-sm font-semibold mb-2">Open Source Licenses</h4><p className="text-xs text-muted-foreground">This project uses multiple open source libraries. <button className="text-primary hover:underline">View full license list</button></p></div>
          </div>
        )}
      </div>
    </div>
  );
}

function LlmProvidersSection() {
  const { data: providers = [], isLoading, refetch } = useLlmProviders();
  const setKey = useSetProviderKey();
  const testProvider = useTestProvider();
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; sampleCount: number; error: string | null }>>({});

  const getDraft = (p: LlmProvider) =>
    drafts[p.id] ?? { apiKey: '', baseUrl: p.baseUrl ?? '' };

  const updateDraft = (id: string, patchDraft: Partial<{ apiKey: string; baseUrl: string }>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { apiKey: '', baseUrl: '' }), ...patchDraft },
    }));
  };

  const onSave = async (p: LlmProvider) => {
    const d = getDraft(p);
    await setKey.mutateAsync({
      providerId: p.id,
      apiKey: d.apiKey || undefined,
      baseUrl: d.baseUrl || undefined,
    });
    updateDraft(p.id, { apiKey: '' });
    toast.success(`${p.name} updated`);
  };

  const onTest = async (p: LlmProvider) => {
    const res = await testProvider.mutateAsync(p.id);
    setTestResults((current) => ({
      ...current,
      [p.id]: { ok: res.ok, sampleCount: res.sampleModels.length, error: res.error },
    }));
    if (res.ok) toast.success(`${p.name} connected`);
    else toast.error(`${p.name}: ${res.error ?? 'failed'}`);
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">LLM Providers</h2>
        <button onClick={() => refetch()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>
      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {providers.map((p) => {
        const d = getDraft(p);
        const needsKey = p.kind !== 'ollama';
        const testResult = testResults[p.id];
        return (
          <div key={p.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">{p.name}</h3>
                <span className="text-micro font-mono text-muted-foreground">{p.kind}</span>
              </div>
              <span className={cn('text-micro px-2 py-0.5 rounded-full', p.connected ? 'text-success bg-success/10' : 'text-muted-foreground bg-surface-2')}>
                {p.connected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {needsKey && (
              <div>
                <label htmlFor={`api-key-${p.id}`} className="text-xs font-medium mb-1 block">
                  API Key {p.maskedKey && <span className="font-mono text-muted-foreground">(current: {p.maskedKey})</span>}
                </label>
                <Field
                  id={`api-key-${p.id}`}
                  value={d.apiKey}
                  onChange={(v) => updateDraft(p.id, { apiKey: v })}
                  placeholder={p.hasKey ? 'Leave blank to keep current' : 'sk-…'}
                  className="w-full font-mono"
                />
              </div>
            )}
            <div>
              <label htmlFor={`base-url-${p.id}`} className="text-xs font-medium mb-1 block">Base URL</label>
              <Field
                id={`base-url-${p.id}`}
                value={d.baseUrl}
                onChange={(v) => updateDraft(p.id, { baseUrl: v })}
                placeholder={p.baseUrl ?? ''}
                className="w-full font-mono"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void onSave(p)}
                disabled={setKey.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => void onTest(p)}
                disabled={testProvider.isPending}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-50"
              >
                {testProvider.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Test Connection
              </button>
            </div>
            {testResult && (
              <div className={cn('text-xs rounded-md px-3 py-2', testResult.ok ? 'bg-success/5 text-success' : 'bg-destructive/5 text-destructive')}>
                {testResult.ok
                  ? `Test succeeded${testResult.sampleCount > 0 ? ` · ${testResult.sampleCount} sample models returned` : ''}`
                  : `Test failed${testResult.error ? ` · ${testResult.error}` : ''}`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolsSandboxSection({
  draft,
  patch,
  projectId,
}: {
  readonly draft: SettingsState;
  readonly patch: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  readonly projectId: string | null;
}) {
  const workspaceQuery = useWorkspaceInfo(projectId);
  const initWorkspace = useInitWorkspace(projectId);
  const toolOptions = [
    { id: 'web_search', label: 'Web search' },
    { id: 'web_fetch', label: 'Web fetch' },
    { id: 'fs_read', label: 'File read' },
    { id: 'fs_write', label: 'File write' },
    { id: 'fs_list', label: 'File list' },
    { id: 'shell_exec', label: 'Shell exec' },
  ] as const;

  const toggleTool = (toolId: string, enabled: boolean) => {
    const current = new Set(draft.toolsSandbox.enabledTools);
    if (enabled) current.add(toolId);
    else current.delete(toolId);
    patch('toolsSandbox', { ...draft.toolsSandbox, enabledTools: [...current] });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Tools & Sandbox</h2>
        <p className="text-xs text-muted-foreground mt-1">Workspace-backed tool settings for local-first execution. Docker remains an upcoming mode.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Workspace Sandbox</div>
            <div className="text-xs text-muted-foreground">
              {workspaceQuery.data?.sandboxKind === 'local-fs' ? 'Local workspace folder' : 'Pending initialization'}
            </div>
          </div>
          <button
            onClick={() => void initWorkspace.mutateAsync()}
            disabled={!projectId || initWorkspace.isPending}
            className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {initWorkspace.isPending ? 'Initializing...' : 'Initialize Workspace'}
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          Status: <span className="font-mono text-foreground">{workspaceQuery.data?.status ?? 'missing'}</span>
        </div>
        {workspaceQuery.data?.rootPath && (
          <div className="text-xs text-muted-foreground">
            Root: <span className="font-mono text-foreground break-all">{workspaceQuery.data.rootPath}</span>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <Row label="Search Provider" desc="Select the web-search backend HIVE should use by default">
          <SelectField
            value={draft.toolsSandbox.searchProvider}
            options={['searxng', 'tavily']}
            onChange={(value) => patch('toolsSandbox', { ...draft.toolsSandbox, searchProvider: value })}
            className="w-40"
          />
        </Row>
        <Row label="SearxNG URL" desc="Local-first fallback search endpoint">
          <Field
            value={draft.toolsSandbox.searxngUrl}
            onChange={(value) => patch('toolsSandbox', { ...draft.toolsSandbox, searxngUrl: value })}
            className="w-72 font-mono"
          />
        </Row>
        <Row label="Tavily API Key" desc="Optional keyed provider. Blank input keeps the existing stored key.">
          <div className="space-y-2">
            {draft.toolsSandbox.tavilyMaskedKey && (
              <div className="text-micro text-muted-foreground font-mono">
                Current: {draft.toolsSandbox.tavilyMaskedKey}
              </div>
            )}
            <Field
              value={draft.toolsSandbox.tavilyApiKey}
              onChange={(value) => patch('toolsSandbox', { ...draft.toolsSandbox, tavilyApiKey: value })}
              placeholder={draft.toolsSandbox.tavilyMaskedKey ? 'Leave blank to keep current key' : 'tvly-...'}
              className="w-72 font-mono"
            />
          </div>
        </Row>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Enabled Tools</h3>
        <div className="space-y-3">
          {toolOptions.map((tool) => (
            <div key={tool.id} className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{tool.label}</div>
                <div className="text-xs text-muted-foreground font-mono">{tool.id}</div>
              </div>
              <Switch
                checked={draft.toolsSandbox.enabledTools.includes(tool.id)}
                onCheckedChange={(checked) => toggleTool(tool.id, checked)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DataPrivacySection({ draft, patch }: { readonly draft: SettingsState; readonly patch: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">Data & Privacy</h2>
      <ConfirmDeleteModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete All Data"
        description="This will permanently delete all project data, session history, and settings. This action cannot be undone."
        onConfirm={() => { toast.success('All data deleted'); setDeleteOpen(false); }}
      />
      <Row label="Data Retention" desc="How long to keep session data"><SelectField value={draft.dataPrivacy.retention} options={['30 days', '90 days', '1 year']} onChange={(value) => patch('dataPrivacy', { ...draft.dataPrivacy, retention: value })} /></Row>
      <Row label="Export Data" desc="Download all project data"><button onClick={() => toast.success('Data export started — download will begin shortly')} className="text-xs text-primary bg-primary/10 px-3 py-1.5 rounded hover:bg-primary/20">Export</button></Row>
      <Row label="Delete All Data" desc="Permanently delete all project data"><button onClick={() => setDeleteOpen(true)} className="text-xs text-destructive bg-destructive/10 px-3 py-1.5 rounded hover:bg-destructive/20">Delete</button></Row>
      <Row label="Cookie Consent" desc="Manage cookie preferences"><Switch checked={draft.dataPrivacy.cookieConsent} onCheckedChange={(checked) => patch('dataPrivacy', { ...draft.dataPrivacy, cookieConsent: checked })} /></Row>
    </div>
  );
}
