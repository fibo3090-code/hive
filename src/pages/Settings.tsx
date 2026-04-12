import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Settings as SettingsIcon, Cpu, GitBranch, Github, Link2,
  Shield, Bell, Keyboard, Palette, Database, Info, Plug, FileLock, Globe,
  Plus, Trash2, Check, X, Eye, EyeOff,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';

const settingsNav = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'llm', label: 'LLM Providers', icon: Cpu },
  { id: 'router', label: 'Adaptive Router', icon: Cpu },
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
];

export default function Settings() {
  const [section, setSection] = useState('general');

  return (
    <div className="flex h-full">
      <div className="w-52 border-r border-border py-2 overflow-auto scrollbar-thin">
        {settingsNav.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)} className={cn('flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors', section === s.id ? 'bg-primary/10 text-primary border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>
            <s.icon className="h-3.5 w-3.5" /> {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 animate-fade-in">
        {section === 'general' && <GeneralSettings />}
        {section === 'llm' && <LLMSettings />}
        {section === 'router' && <RouterSettings />}
        {section === 'modules' && <ModuleSettings />}
        {section === 'git' && <GitSettings />}
        {section === 'github' && <GitHubSettings />}
        {section === 'integrations' && <IntegrationSettings />}
        {section === 'fileprotect' && <FileProtectionSettings />}
        {section === 'security' && <SecuritySettings />}
        {section === 'notifications' && <NotificationSettings />}
        {section === 'shortcuts' && <ShortcutSettings />}
        {section === 'appearance' && <AppearanceSettings />}
        {section === 'data' && <DataSettings />}
        {section === 'about' && <AboutSettings />}
      </div>
    </div>
  );
}

function SettingRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border">
      <div><span className="text-sm font-medium">{label}</span><p className="text-xs text-muted-foreground">{desc}</p></div>
      {children}
    </div>
  );
}

function GeneralSettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">General Settings</h2>
      <SettingRow label="Project Name" desc="Display name for this project"><input className="h-8 rounded-md border border-border bg-surface-2 px-3 text-sm w-64" defaultValue="HIVE Dashboard" /></SettingRow>
      <SettingRow label="Auto-save" desc="Automatically save changes"><Switch defaultChecked /></SettingRow>
      <SettingRow label="Session Timeout" desc="Auto-pause after inactivity (minutes)"><Slider defaultValue={[30]} max={120} step={5} className="w-48" /></SettingRow>
      <SettingRow label="Default Sovereignty Tier" desc="Data sovereignty level for new projects">
        <div className="flex gap-1">{['Local', 'Hybrid', 'Cloud'].map(t => (<button key={t} className={cn('rounded-md px-3 py-1 text-xs border', t === 'Hybrid' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>{t}</button>))}</div>
      </SettingRow>
      <SettingRow label="Telemetry" desc="Send anonymous usage data"><Switch /></SettingRow>
      <SettingRow label="Language" desc="Interface language"><select className="h-8 rounded-md border border-border bg-surface-2 px-3 text-sm"><option>English</option><option>日本語</option><option>Deutsch</option></select></SettingRow>
    </div>
  );
}

function LLMSettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">LLM Providers</h2>
      {[
        { name: 'OpenAI', models: ['GPT-4o', 'GPT-4o-mini', 'GPT-4-turbo'], connected: true, apiKey: '••••••••••sk-abc' },
        { name: 'Anthropic', models: ['Claude 3.5 Sonnet', 'Claude 3 Haiku', 'Claude 3 Opus'], connected: true, apiKey: '••••••••••ant-xyz' },
        { name: 'Google', models: ['Gemini Pro', 'Gemini Flash', 'Gemini Ultra'], connected: false },
        { name: 'Local (Ollama)', models: ['Llama 3', 'CodeLlama', 'Mistral'], connected: false },
      ].map(p => (
        <div key={p.name} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">{p.name}</h3>
            <Switch defaultChecked={p.connected} />
          </div>
          {p.apiKey && <div className="flex items-center gap-2 mb-2"><span className="text-xs font-mono text-muted-foreground">{p.apiKey}</span><button className="text-muted-foreground hover:text-foreground"><Eye className="h-3 w-3" /></button></div>}
          <div className="flex gap-1.5 flex-wrap">{p.models.map(m => (<span key={m} className="text-micro bg-surface-2 rounded px-2 py-0.5 font-mono">{m}</span>))}</div>
        </div>
      ))}
    </div>
  );
}

function RouterSettings() {
  const routingTable = [
    { task: 'Code Generation', model: 'GPT-4o', score: 0.92, cost: '$0.03/1K' },
    { task: 'Code Review', model: 'Claude 3.5 Sonnet', score: 0.95, cost: '$0.015/1K' },
    { task: 'Testing', model: 'Claude 3.5 Sonnet', score: 0.91, cost: '$0.015/1K' },
    { task: 'Documentation', model: 'Gemini Pro', score: 0.88, cost: '$0.007/1K' },
    { task: 'Planning', model: 'GPT-4o', score: 0.94, cost: '$0.03/1K' },
  ];
  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-lg font-semibold">Adaptive Router</h2>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-3"><span className="text-micro text-muted-foreground">Routing Mode</span><span className="block text-sm font-semibold mt-1">Multi-Armed Bandit</span></div>
        <div className="rounded-lg border border-border bg-card p-3"><span className="text-micro text-muted-foreground">Exploration Rate</span><span className="block text-sm font-semibold mt-1 font-mono">ε = 0.1</span></div>
        <div className="rounded-lg border border-success/30 bg-success/5 p-3"><span className="text-micro text-muted-foreground">Est. Savings</span><span className="block text-sm font-semibold mt-1 text-success font-mono">-23%</span></div>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left px-4 py-2">Task Type</th><th className="text-left px-4 py-2">Best Model</th><th className="text-left px-4 py-2">Score</th><th className="text-left px-4 py-2">Cost</th></tr></thead>
          <tbody className="divide-y divide-border">
            {routingTable.map(r => (<tr key={r.task} className="hover:bg-surface-2/50"><td className="px-4 py-2 font-medium">{r.task}</td><td className="px-4 py-2 font-mono text-muted-foreground">{r.model}</td><td className="px-4 py-2 font-mono text-primary">{r.score}</td><td className="px-4 py-2 font-mono text-muted-foreground">{r.cost}</td></tr>))}
          </tbody>
        </table>
      </div>
      <SettingRow label="Enable Router" desc="Auto-select best model per task"><Switch defaultChecked /></SettingRow>
      <SettingRow label="Exploration Rate" desc="Probability of trying non-optimal model"><Slider defaultValue={[10]} max={50} step={5} className="w-48" /></SettingRow>
    </div>
  );
}

function ModuleSettings() {
  const installed = [
    { name: 'Auth Module', version: '2.1.0', enabled: true },
    { name: 'Database ORM', version: '3.0.1', enabled: true },
    { name: 'Eval Engine', version: '1.4.0', enabled: true },
  ];
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">HCM Modules</h2>
      {installed.map(m => (
        <div key={m.name} className="flex items-center justify-between py-3 border-b border-border">
          <div><span className="text-sm font-medium">{m.name}</span><span className="text-micro font-mono text-muted-foreground ml-2">v{m.version}</span></div>
          <Switch defaultChecked={m.enabled} />
        </div>
      ))}
    </div>
  );
}

function GitSettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">Git Configuration</h2>
      <SettingRow label="Auto-commit" desc="Automatically commit agent changes"><Switch defaultChecked /></SettingRow>
      <SettingRow label="Commit Prefix" desc="Prefix for agent commits"><input className="h-8 rounded-md border border-border bg-surface-2 px-3 text-sm w-48 font-mono" defaultValue="[hive]" /></SettingRow>
      <SettingRow label="Branch Strategy" desc="How to manage branches">
        <select className="h-8 rounded-md border border-border bg-surface-2 px-3 text-sm"><option>Feature branches</option><option>Trunk-based</option><option>Git flow</option></select>
      </SettingRow>
      <SettingRow label="Squash Commits" desc="Squash session commits on merge"><Switch defaultChecked /></SettingRow>
    </div>
  );
}

function GitHubSettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">GitHub Sync</h2>
      <div className="rounded-lg border border-success/30 bg-success/5 p-4 flex items-center gap-3">
        <Check className="h-4 w-4 text-success" />
        <div><span className="text-sm font-medium text-success">Connected</span><p className="text-xs text-muted-foreground">github.com/org/hive-dashboard</p></div>
      </div>
      <SettingRow label="Auto-push" desc="Push commits to remote automatically"><Switch defaultChecked /></SettingRow>
      <SettingRow label="PR Auto-create" desc="Create PRs for feature branches"><Switch defaultChecked /></SettingRow>
      <SettingRow label="Status Checks" desc="Require CI checks before merge"><Switch defaultChecked /></SettingRow>
    </div>
  );
}

function IntegrationSettings() {
  const integrations = [
    { name: 'Slack', status: 'connected', icon: '💬' },
    { name: 'Linear', status: 'connected', icon: '📋' },
    { name: 'Sentry', status: 'disconnected', icon: '🐛' },
    { name: 'Datadog', status: 'disconnected', icon: '📊' },
    { name: 'PagerDuty', status: 'disconnected', icon: '🔔' },
  ];
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">Integrations</h2>
      {integrations.map(i => (
        <div key={i.name} className="flex items-center justify-between py-3 border-b border-border">
          <div className="flex items-center gap-2"><span className="text-lg">{i.icon}</span><span className="text-sm font-medium">{i.name}</span></div>
          {i.status === 'connected' ? (
            <span className="text-micro text-success bg-success/10 px-2 py-0.5 rounded-full">Connected</span>
          ) : (
            <button className="text-micro text-primary bg-primary/10 px-2 py-0.5 rounded-full hover:bg-primary/20">Connect</button>
          )}
        </div>
      ))}
    </div>
  );
}

function FileProtectionSettings() {
  const protectedFiles = ['src/lib/auth.ts', 'src/config/env.ts', '.env', 'package.json'];
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">File Protection</h2>
      <p className="text-xs text-muted-foreground">Protected files require human approval before agent modification.</p>
      {protectedFiles.map(f => (
        <div key={f} className="flex items-center justify-between py-2 border-b border-border">
          <span className="text-sm font-mono">{f}</span>
          <button className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <button className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Add protected file</button>
    </div>
  );
}

function SecuritySettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">Security & Compliance</h2>
      <SettingRow label="Outbound Prompt Warning" desc="Warn before sending prompts to external APIs"><Switch defaultChecked /></SettingRow>
      <SettingRow label="API Risk Approval" desc="Require approval for risky API calls"><Switch defaultChecked /></SettingRow>
      <SettingRow label="Secret Scanning" desc="Scan code for leaked credentials"><Switch defaultChecked /></SettingRow>
      <SettingRow label="Audit Log Retention" desc="How long to keep audit logs"><select className="h-8 rounded-md border border-border bg-surface-2 px-3 text-sm"><option>30 days</option><option>90 days</option><option>1 year</option><option>Forever</option></select></SettingRow>
      <SettingRow label="IP Allowlist" desc="Restrict access to specific IPs"><Switch /></SettingRow>
    </div>
  );
}

function NotificationSettings() {
  const channels = [
    { label: 'Budget warnings', email: true, slack: true, inApp: true },
    { label: 'Agent errors', email: true, slack: true, inApp: true },
    { label: 'Spec drift', email: false, slack: true, inApp: true },
    { label: 'PR updates', email: false, slack: false, inApp: true },
    { label: 'Session summaries', email: true, slack: false, inApp: true },
  ];
  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <div className="rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left px-4 py-2">Event</th><th className="text-center px-4 py-2">Email</th><th className="text-center px-4 py-2">Slack</th><th className="text-center px-4 py-2">In-App</th></tr></thead>
          <tbody className="divide-y divide-border">
            {channels.map(c => (
              <tr key={c.label}><td className="px-4 py-2 font-medium">{c.label}</td>
                <td className="px-4 py-2 text-center"><Switch defaultChecked={c.email} /></td>
                <td className="px-4 py-2 text-center"><Switch defaultChecked={c.slack} /></td>
                <td className="px-4 py-2 text-center"><Switch defaultChecked={c.inApp} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShortcutSettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
      {[
        { keys: '⌘K', action: 'Command Palette' },
        { keys: '⌘1-8', action: 'Navigate panels' },
        { keys: '⌘⏎', action: 'Send message' },
        { keys: '⌘.', action: 'Toggle sidebar' },
        { keys: '⌘/', action: 'Search files' },
        { keys: '⌘⇧P', action: 'Pause all agents' },
        { keys: '⌘⇧S', action: 'Save all' },
        { keys: '⌘B', action: 'Toggle file tree' },
        { keys: 'Esc', action: 'Close drawer/modal' },
      ].map(s => (
        <div key={s.keys} className="flex items-center justify-between py-2 border-b border-border">
          <span className="text-sm">{s.action}</span>
          <kbd className="rounded bg-surface-2 px-2 py-0.5 text-xs font-mono text-muted-foreground">{s.keys}</kbd>
        </div>
      ))}
    </div>
  );
}

function AppearanceSettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">Appearance</h2>
      <SettingRow label="Theme" desc="UI color scheme">
        <div className="flex gap-2">
          {[{ label: 'Dark', active: true }, { label: 'Light', active: false }, { label: 'System', active: false }].map(t => (
            <button key={t.label} className={cn('rounded-md px-3 py-1 text-xs border', t.active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>{t.label}</button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Accent Color" desc="Brand color for highlights">
        <div className="flex gap-2">
          {['#F5C542', '#3B82F6', '#22C55E', '#EF4444', '#A855F7'].map(c => (
            <button key={c} className={cn('h-6 w-6 rounded-full border-2', c === '#F5C542' ? 'border-foreground' : 'border-transparent')} style={{ backgroundColor: c }} />
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Font Size" desc="Base font size"><Slider defaultValue={[14]} min={12} max={18} step={1} className="w-48" /></SettingRow>
      <SettingRow label="Reduce Motion" desc="Minimize animations"><Switch /></SettingRow>
      <SettingRow label="Compact Mode" desc="Reduce spacing between elements"><Switch /></SettingRow>
    </div>
  );
}

function DataSettings() {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold">Data & Privacy</h2>
      <SettingRow label="Data Retention" desc="How long to keep session data"><select className="h-8 rounded-md border border-border bg-surface-2 px-3 text-sm"><option>30 days</option><option>90 days</option><option>1 year</option></select></SettingRow>
      <SettingRow label="Export Data" desc="Download all project data"><button className="text-xs text-primary bg-primary/10 px-3 py-1.5 rounded hover:bg-primary/20">Export</button></SettingRow>
      <SettingRow label="Delete All Data" desc="Permanently delete all project data"><button className="text-xs text-destructive bg-destructive/10 px-3 py-1.5 rounded hover:bg-destructive/20">Delete</button></SettingRow>
      <SettingRow label="Cookie Consent" desc="Manage cookie preferences"><Switch defaultChecked /></SettingRow>
    </div>
  );
}

function AboutSettings() {
  return (
    <div className="space-y-4 max-w-xl">
      <h2 className="text-lg font-semibold">About HIVE</h2>
      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="text-display-sm text-primary mb-2">HIVE v6.0</h3>
        <p className="text-sm text-muted-foreground mb-4">Autonomous Agent Orchestration Platform</p>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex justify-between"><span>Version</span><span className="font-mono">6.0.0-beta</span></div>
          <div className="flex justify-between"><span>Build</span><span className="font-mono">2026.04.09</span></div>
          <div className="flex justify-between"><span>Runtime</span><span className="font-mono">React 18 + Vite 5</span></div>
          <div className="flex justify-between"><span>UI Framework</span><span className="font-mono">Tailwind CSS + shadcn/ui</span></div>
          <div className="flex justify-between"><span>Graph Engine</span><span className="font-mono">React Flow</span></div>
          <div className="flex justify-between"><span>Charts</span><span className="font-mono">Recharts</span></div>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="text-sm font-semibold mb-2">Open Source Licenses</h4>
        <p className="text-xs text-muted-foreground">This project uses multiple open source libraries. <button className="text-primary hover:underline">View full license list</button></p>
      </div>
    </div>
  );
}
