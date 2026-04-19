import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { useSettingsData } from '@/api/queries/useServerData';

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

export type AccentPresetId = 'amber' | 'blue' | 'green' | 'red' | 'violet';

interface AccentPreset {
  id: AccentPresetId;
  label: string;
  hsl: string;
  hex: string;
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
  onboardingDraft: OnboardingDraft;
  chatTargetAgentId: string | null;
  graphFocusAgentId: string | null;
  selectedCommandId: string | null;
}

interface WorkspaceContextValue extends WorkspaceState {
  accentPresets: AccentPreset[];
  updateOnboardingDraft: (updater: Partial<OnboardingDraft> | ((draft: OnboardingDraft) => OnboardingDraft)) => void;
  resetOnboardingDraft: () => void;
  setChatTargetAgentId: (agentId: string | null) => void;
  setGraphFocusAgentId: (agentId: string | null) => void;
  setSelectedCommandId: (commandId: string | null) => void;
}

const STORAGE_KEY = 'hive-workspace-ui';

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

export const defaultSettings: SettingsState = {
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

const defaultState: WorkspaceState = {
  onboardingDraft: defaultOnboardingDraft,
  chatTargetAgentId: null,
  graphFocusAgentId: null,
  selectedCommandId: null,
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readState(): WorkspaceState {
  if (typeof window === 'undefined') {
    return defaultState;
  }

  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultState;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    return {
      ...defaultState,
      ...parsed,
      onboardingDraft: { ...defaultOnboardingDraft, ...parsed.onboardingDraft },
    };
  } catch (error) {
    console.error('Failed to read workspace state', error);
    return defaultState;
  }
}

export function WorkspaceProvider({ children }: { readonly children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(() => readState());
  const { setTheme } = useTheme();
  const settingsQuery = useSettingsData();
  const appearance = settingsQuery.data?.appearance ?? defaultSettings.appearance;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    setTheme(appearance.theme);
  }, [appearance.theme, setTheme]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const accent = accentPresets.find((preset) => preset.id === appearance.accent) ?? accentPresets[0];

    root.style.setProperty('--primary', accent.hsl);
    root.style.setProperty('--ring', accent.hsl);
    root.style.setProperty('--sidebar-primary', accent.hsl);
    root.style.setProperty('--chart-1', accent.hsl);
    root.style.fontSize = `${appearance.fontSize}px`;
    root.dataset.accent = accent.id;
    root.dataset.compact = String(appearance.compactMode);
    root.dataset.motion = appearance.reduceMotion ? 'reduced' : 'full';
    root.classList.toggle('reduce-motion', appearance.reduceMotion);
    root.classList.toggle('compact-mode', appearance.compactMode);
  }, [appearance]);

  const updateOnboardingDraft = useCallback(
    (updater: Partial<OnboardingDraft> | ((draft: OnboardingDraft) => OnboardingDraft)) => {
      setState((current) => ({
        ...current,
        onboardingDraft:
          typeof updater === 'function'
            ? updater(current.onboardingDraft)
            : { ...current.onboardingDraft, ...updater },
      }));
    },
    []
  );

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

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ...state,
      accentPresets,
      updateOnboardingDraft,
      resetOnboardingDraft,
      setChatTargetAgentId,
      setGraphFocusAgentId,
      setSelectedCommandId,
    }),
    [
      state,
      updateOnboardingDraft,
      resetOnboardingDraft,
      setChatTargetAgentId,
      setGraphFocusAgentId,
      setSelectedCommandId,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }

  return context;
}
