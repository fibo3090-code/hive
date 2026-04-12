import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTheme } from 'next-themes';

type ThemeMode = 'dark' | 'light' | 'system';

export interface OnboardingDraft {
  step: number;
  source: 'scratch' | 'template' | 'import' | null;
  budget: number;
  agents: number;
  tier: 'local' | 'hybrid' | 'cloud';
  describeMode: 'interview' | 'import';
  description: string;
  uploadedSpecName: string | null;
}

export interface HiveMindNote {
  id: string;
  category: 'Architecture' | 'Decisions' | 'Patterns' | 'Issues' | 'Auto-generated';
  title: string;
  content: string;
  auto: boolean;
  author: string;
  time: string;
}

export interface TechDebtItem {
  id: string;
  title: string;
  severity: 'high' | 'medium' | 'low';
  file: string;
  description: string;
  lines: number;
  impact: string;
}

export interface SprintPlanItem {
  id: string;
  name: string;
  status: 'active' | 'planned' | 'completed';
  progress: number;
  startDate: string;
  endDate: string;
  tasks: number;
  completed: number;
  velocity: number | null;
  points: number;
}

export interface SettingsState {
  general: {
    projectName: string;
    autoSave: boolean;
    sessionTimeout: number;
    sovereigntyTier: 'local' | 'hybrid' | 'cloud';
    telemetry: boolean;
    language: 'English' | 'Deutsch' | '日本語';
  };
  llmProviders: Array<{
    name: 'OpenAI' | 'Anthropic' | 'Google' | 'Local (Ollama)';
    connected: boolean;
    apiKey?: string;
    maskedKey?: string;
    revealKey: boolean;
  }>;
  router: {
    enabled: boolean;
    explorationRate: number;
  };
  modules: Record<string, boolean>;
  git: {
    autoCommit: boolean;
    commitPrefix: string;
    branchStrategy: 'Feature branches' | 'Trunk-based' | 'Git flow';
    squashCommits: boolean;
  };
  github: {
    autoPush: boolean;
    autoCreatePr: boolean;
    requireChecks: boolean;
  };
  integrations: Record<string, 'connected' | 'disconnected'>;
  fileProtection: {
    files: string[];
  };
  security: {
    outboundPromptWarning: boolean;
    apiRiskApproval: boolean;
    secretScanning: boolean;
    auditLogRetention: '30 days' | '90 days' | '1 year' | 'Forever';
    ipAllowlist: boolean;
  };
  notifications: Array<{
    label: string;
    email: boolean;
    slack: boolean;
    inApp: boolean;
  }>;
  appearance: {
    theme: ThemeMode;
    accent: AccentPresetId;
    fontSize: number;
    reduceMotion: boolean;
    compactMode: boolean;
  };
  dataPrivacy: {
    retention: '30 days' | '90 days' | '1 year';
    cookieConsent: boolean;
  };
}

interface WorkspaceState {
  settings: SettingsState;
  onboardingDraft: OnboardingDraft;
  chatTargetAgentId: string | null;
  graphFocusAgentId: string | null;
  selectedCommandId: string | null;
  hiveMindNotes: HiveMindNote[];
  techDebtItems: TechDebtItem[];
  sprintPlanItems: SprintPlanItem[];
}

interface WorkspaceContextValue extends WorkspaceState {
  accentPresets: AccentPreset[];
  updateSettings: (settings: SettingsState) => void;
  updateOnboardingDraft: (updater: Partial<OnboardingDraft> | ((draft: OnboardingDraft) => OnboardingDraft)) => void;
  resetOnboardingDraft: () => void;
  setChatTargetAgentId: (agentId: string | null) => void;
  setGraphFocusAgentId: (agentId: string | null) => void;
  setSelectedCommandId: (commandId: string | null) => void;
  addHiveMindNote: (note: Pick<HiveMindNote, 'category' | 'title' | 'content'>) => void;
  moveTechDebtItem: (itemId: string, severity: TechDebtItem['severity']) => void;
  reorderSprintPlanItems: (fromId: string, toId: string) => void;
}

interface AccentPreset {
  id: AccentPresetId;
  label: string;
  hsl: string;
  hex: string;
}

export type AccentPresetId = 'amber' | 'blue' | 'green' | 'red' | 'violet';

const STORAGE_KEY = 'hive-workspace';

export const accentPresets: AccentPreset[] = [
  { id: 'amber', label: 'Amber', hsl: '44 90% 61%', hex: '#F5C542' },
  { id: 'blue', label: 'Blue', hsl: '217 91% 60%', hex: '#3B82F6' },
  { id: 'green', label: 'Green', hsl: '142 71% 45%', hex: '#22C55E' },
  { id: 'red', label: 'Red', hsl: '0 72% 51%', hex: '#EF4444' },
  { id: 'violet', label: 'Violet', hsl: '271 91% 65%', hex: '#A855F7' },
];

const defaultOnboardingDraft: OnboardingDraft = {
  step: 0,
  source: null,
  budget: 100,
  agents: 4,
  tier: 'hybrid',
  describeMode: 'interview',
  description: '',
  uploadedSpecName: null,
};

const defaultSettings: SettingsState = {
  general: {
    projectName: 'HIVE Dashboard',
    autoSave: true,
    sessionTimeout: 30,
    sovereigntyTier: 'hybrid',
    telemetry: false,
    language: 'English',
  },
  llmProviders: [
    { name: 'OpenAI', connected: true, apiKey: 'sk-demo-openai-1234', maskedKey: '••••••••••sk-1234', revealKey: false },
    { name: 'Anthropic', connected: true, apiKey: 'ant-demo-anthropic-5678', maskedKey: '••••••••••ant-5678', revealKey: false },
    { name: 'Google', connected: false, apiKey: 'gemini-demo-key-2468', maskedKey: '••••••••••gem-2468', revealKey: false },
    { name: 'Local (Ollama)', connected: false, revealKey: false },
  ],
  router: {
    enabled: true,
    explorationRate: 10,
  },
  modules: {
    'Auth Module': true,
    'Database ORM': true,
    'Eval Engine': true,
  },
  git: {
    autoCommit: true,
    commitPrefix: '[hive]',
    branchStrategy: 'Feature branches',
    squashCommits: true,
  },
  github: {
    autoPush: true,
    autoCreatePr: true,
    requireChecks: true,
  },
  integrations: {
    Slack: 'connected',
    Linear: 'connected',
    Sentry: 'disconnected',
    Datadog: 'disconnected',
    PagerDuty: 'disconnected',
  },
  fileProtection: {
    files: ['src/lib/auth.ts', 'src/config/env.ts', '.env', 'package.json'],
  },
  security: {
    outboundPromptWarning: true,
    apiRiskApproval: true,
    secretScanning: true,
    auditLogRetention: '30 days',
    ipAllowlist: false,
  },
  notifications: [
    { label: 'Budget warnings', email: true, slack: true, inApp: true },
    { label: 'Agent errors', email: true, slack: true, inApp: true },
    { label: 'Spec drift', email: false, slack: true, inApp: true },
    { label: 'PR updates', email: false, slack: false, inApp: true },
    { label: 'Session summaries', email: true, slack: false, inApp: true },
  ],
  appearance: {
    theme: 'dark',
    accent: 'amber',
    fontSize: 14,
    reduceMotion: false,
    compactMode: false,
  },
  dataPrivacy: {
    retention: '90 days',
    cookieConsent: true,
  },
};

const defaultHiveMindNotes: HiveMindNote[] = [
  {
    id: 'n1',
    category: 'Architecture',
    title: 'Authentication Flow',
    content: 'JWT with httpOnly cookies. Refresh token rotation every 15 min. Rate limiting: 100 req/min per user.\n\nDecision: Using RS256 over HS256 for key rotation support.',
    auto: false,
    author: 'Backend Engineer',
    time: '25 min ago',
  },
  {
    id: 'n2',
    category: 'Decisions',
    title: 'Database Schema v2',
    content: 'Migrated from flat user table to normalized structure: users, user_profiles, user_sessions. Reason: query performance degraded at >10K rows.',
    auto: false,
    author: 'Backend Engineer',
    time: '1 hr ago',
  },
  {
    id: 'n3',
    category: 'Patterns',
    title: 'Error Handling Pattern',
    content: 'All API calls use a Result wrapper. Components receive typed errors. Toasts surface user-facing issues; internal failures stay in logs.',
    auto: false,
    author: 'Frontend Architect',
    time: '2 hr ago',
  },
  {
    id: 'n4',
    category: 'Auto-generated',
    title: 'Recurring Pattern: Auth Checks',
    content: 'Detected 12 occurrences of manual auth checks across route handlers. Suggestion: extract to middleware.',
    auto: true,
    author: 'System',
    time: '15 min ago',
  },
  {
    id: 'n5',
    category: 'Issues',
    title: 'WebSocket Timeout',
    content: 'WebSocket connections timeout after 30s of inactivity. Need heartbeat mechanism. Affecting 2/5 integration tests.',
    auto: false,
    author: 'QA Sentinel',
    time: '45 min ago',
  },
];

const defaultTechDebtItems: TechDebtItem[] = [
  { id: 'd1', title: 'Refactor auth module', severity: 'high', file: 'src/lib/auth.ts', description: 'Monolithic auth file needs splitting into separate concerns', lines: 450, impact: 'High coupling, hard to test' },
  { id: 'd2', title: 'Update deprecated APIs', severity: 'medium', file: 'src/lib/api.ts', description: 'Using deprecated fetch patterns — switch to new API client', lines: 120, impact: 'Will break in next major version' },
  { id: 'd3', title: 'Add error boundaries', severity: 'medium', file: 'src/App.tsx', description: 'No error boundaries in component tree', lines: 0, impact: 'Uncaught errors crash entire app' },
  { id: 'd4', title: 'Optimize re-renders', severity: 'low', file: 'src/components/', description: 'Multiple unnecessary re-renders detected via profiler', lines: 0, impact: 'Performance degradation on large datasets' },
  { id: 'd5', title: 'Remove dead code', severity: 'low', file: 'src/utils/', description: '14 unused utility functions detected', lines: 280, impact: 'Bundle size, maintenance burden' },
];

const defaultSprintPlanItems: SprintPlanItem[] = [
  { id: 'sprint-3', name: 'Sprint 3', status: 'active', progress: 45, startDate: 'Apr 1', endDate: 'Apr 14', tasks: 12, completed: 5, velocity: 34, points: 42 },
  { id: 'sprint-4', name: 'Sprint 4', status: 'planned', progress: 0, startDate: 'Apr 15', endDate: 'Apr 28', tasks: 8, completed: 0, velocity: null, points: 31 },
  { id: 'sprint-2', name: 'Sprint 2', status: 'completed', progress: 100, startDate: 'Mar 18', endDate: 'Mar 31', tasks: 10, completed: 10, velocity: 38, points: 38 },
];

const defaultState: WorkspaceState = {
  settings: defaultSettings,
  onboardingDraft: defaultOnboardingDraft,
  chatTargetAgentId: null,
  graphFocusAgentId: null,
  selectedCommandId: null,
  hiveMindNotes: defaultHiveMindNotes,
  techDebtItems: defaultTechDebtItems,
  sprintPlanItems: defaultSprintPlanItems,
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readState(): WorkspaceState {
  if (typeof window === 'undefined') {
    return defaultState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultState;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    return {
      ...defaultState,
      ...parsed,
      settings: {
        ...defaultSettings,
        ...parsed.settings,
        general: { ...defaultSettings.general, ...parsed.settings?.general },
        router: { ...defaultSettings.router, ...parsed.settings?.router },
        modules: { ...defaultSettings.modules, ...parsed.settings?.modules },
        git: { ...defaultSettings.git, ...parsed.settings?.git },
        github: { ...defaultSettings.github, ...parsed.settings?.github },
        integrations: { ...defaultSettings.integrations, ...parsed.settings?.integrations },
        fileProtection: {
          ...defaultSettings.fileProtection,
          ...parsed.settings?.fileProtection,
        },
        security: { ...defaultSettings.security, ...parsed.settings?.security },
        appearance: { ...defaultSettings.appearance, ...parsed.settings?.appearance },
        dataPrivacy: { ...defaultSettings.dataPrivacy, ...parsed.settings?.dataPrivacy },
        llmProviders: parsed.settings?.llmProviders ?? defaultSettings.llmProviders,
        notifications: parsed.settings?.notifications ?? defaultSettings.notifications,
      },
      onboardingDraft: { ...defaultOnboardingDraft, ...parsed.onboardingDraft },
      hiveMindNotes: parsed.hiveMindNotes ?? defaultHiveMindNotes,
      techDebtItems: parsed.techDebtItems ?? defaultTechDebtItems,
      sprintPlanItems: parsed.sprintPlanItems ?? defaultSprintPlanItems,
    };
  } catch (error) {
    console.error('Failed to read workspace state', error);
    return defaultState;
  }
}

function reorderItems<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
  const sourceIndex = items.findIndex((item) => item.id === fromId);
  const targetIndex = items.findIndex((item) => item.id === toId);

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(() => readState());
  const { setTheme } = useTheme();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    setTheme(state.settings.appearance.theme);
  }, [setTheme, state.settings.appearance.theme]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const accent = accentPresets.find((preset) => preset.id === state.settings.appearance.accent) ?? accentPresets[0];

    root.style.setProperty('--primary', accent.hsl);
    root.style.setProperty('--ring', accent.hsl);
    root.style.setProperty('--sidebar-primary', accent.hsl);
    root.style.setProperty('--chart-1', accent.hsl);
    root.style.fontSize = `${state.settings.appearance.fontSize}px`;
    root.dataset.accent = accent.id;
    root.dataset.compact = String(state.settings.appearance.compactMode);
    root.dataset.motion = state.settings.appearance.reduceMotion ? 'reduced' : 'full';
    root.classList.toggle('reduce-motion', state.settings.appearance.reduceMotion);
    root.classList.toggle('compact-mode', state.settings.appearance.compactMode);
  }, [state.settings.appearance]);

  const updateSettings = useCallback((settings: SettingsState) => {
    setState((current) => ({ ...current, settings }));
  }, []);

  const updateOnboardingDraft = useCallback((updater: Partial<OnboardingDraft> | ((draft: OnboardingDraft) => OnboardingDraft)) => {
    setState((current) => ({
      ...current,
      onboardingDraft:
        typeof updater === 'function'
          ? updater(current.onboardingDraft)
          : { ...current.onboardingDraft, ...updater },
    }));
  }, []);

  const resetOnboardingDraft = useCallback(() => {
    setState((current) => ({ ...current, onboardingDraft: defaultOnboardingDraft }));
  }, []);

  const setChatTargetAgentId = useCallback((agentId: string | null) => {
    setState((current) => ({ ...current, chatTargetAgentId: agentId }));
  }, []);

  const setGraphFocusAgentId = useCallback((agentId: string | null) => {
    setState((current) => ({ ...current, graphFocusAgentId: agentId }));
  }, []);

  const setSelectedCommandId = useCallback((commandId: string | null) => {
    setState((current) => ({ ...current, selectedCommandId: commandId }));
  }, []);

  const addHiveMindNote = useCallback((note: Pick<HiveMindNote, 'category' | 'title' | 'content'>) => {
    setState((current) => ({
      ...current,
      hiveMindNotes: [
        {
          id: `note-${Date.now()}`,
          author: 'Operator',
          auto: false,
          time: 'just now',
          ...note,
        },
        ...current.hiveMindNotes,
      ],
    }));
  }, []);

  const moveTechDebtItem = useCallback((itemId: string, severity: TechDebtItem['severity']) => {
    setState((current) => ({
      ...current,
      techDebtItems: current.techDebtItems.map((item) =>
        item.id === itemId ? { ...item, severity } : item
      ),
    }));
  }, []);

  const reorderSprintPlanItems = useCallback((fromId: string, toId: string) => {
    setState((current) => ({
      ...current,
      sprintPlanItems: reorderItems(current.sprintPlanItems, fromId, toId),
    }));
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => ({
    ...state,
    accentPresets,
    updateSettings,
    updateOnboardingDraft,
    resetOnboardingDraft,
    setChatTargetAgentId,
    setGraphFocusAgentId,
    setSelectedCommandId,
    addHiveMindNote,
    moveTechDebtItem,
    reorderSprintPlanItems,
  }), [
    state,
    updateSettings,
    updateOnboardingDraft,
    resetOnboardingDraft,
    setChatTargetAgentId,
    setGraphFocusAgentId,
    setSelectedCommandId,
    addHiveMindNote,
    moveTechDebtItem,
    reorderSprintPlanItems,
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }

  return context;
}
