/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { useSettingsData } from '@/api/queries/useServerData';

type ThemeMode = 'dark' | 'light' | 'system';
import type { SovereigntyTier } from '@/types/domain';

export interface OnboardingDraft {
  step: number;
  source: 'scratch' | 'template' | 'import' | null;
  budget: number;
  agents: number;
  tier: SovereigntyTier;
  describeMode: 'interview' | 'import';
  description: string;
  uploadedSpecName: string | null;
  /** Phase 2: when on, the CEO chat in the Describe step is allowed to
   *  delegate to a base team (research / architect / product) instead
   *  of doing solo lower-quality research. Persisted so a refresh mid-
   *  onboarding doesn't lose the choice. */
  teamMode: boolean;
  /** Phase 2: ids of LLM providers the user has confirmed in the new
   *  "Connect LLMs" step. Acts as a guard so we don't advance past
   *  Connect-LLMs without at least one working provider. Stored as ids
   *  rather than masked keys so the Settings UI is the single source of
   *  truth for the actual credentials. */
  connectedProviderIds: string[];
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
    sovereigntyTier: SovereigntyTier;
    telemetry: boolean;
    language: 'English' | 'Deutsch' | '日本語';
  };
  defaultModel: DefaultModelSelection | null;
  router: {
    enabled: boolean;
    explorationRate: number;
  };
  toolsSandbox: {
    searchProvider: 'searxng' | 'tavily';
    searxngUrl: string;
    tavilyApiKey: string;
    tavilyMaskedKey: string | null;
    enabledTools: string[];
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

export interface DefaultModelSelection {
  providerId: string;
  modelId: string;
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
  defaultModel: DefaultModelSelection | null;
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
  tier: 'local',
  describeMode: 'interview',
  description: '',
  uploadedSpecName: null,
  teamMode: true,
  connectedProviderIds: [],
};

export const defaultSettings: SettingsState = {
  general: {
    projectName: 'HIVE Dashboard',
    autoSave: true,
    sessionTimeout: 30,
    sovereigntyTier: 'local',
    telemetry: false,
    language: 'English',
  },
  defaultModel: null,
  router: {
    enabled: true,
    explorationRate: 10,
  },
  toolsSandbox: {
    searchProvider: 'searxng',
    searxngUrl: 'http://localhost:8888',
    tavilyApiKey: '',
    tavilyMaskedKey: null,
    enabledTools: ['web_search', 'web_fetch', 'fs_read', 'fs_write', 'fs_list', 'shell_exec'],
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

export function mergeSettings(partial?: Partial<SettingsState> | null): SettingsState {
  return {
    ...defaultSettings,
    ...partial,
    general: { ...defaultSettings.general, ...partial?.general },
    defaultModel: partial?.defaultModel ?? defaultSettings.defaultModel,
    router: { ...defaultSettings.router, ...partial?.router },
    toolsSandbox: { ...defaultSettings.toolsSandbox, ...partial?.toolsSandbox },
    modules: { ...defaultSettings.modules, ...partial?.modules },
    git: { ...defaultSettings.git, ...partial?.git },
    github: { ...defaultSettings.github, ...partial?.github },
    integrations: { ...defaultSettings.integrations, ...partial?.integrations },
    fileProtection: {
      ...defaultSettings.fileProtection,
      ...partial?.fileProtection,
      files: partial?.fileProtection?.files ?? defaultSettings.fileProtection.files,
    },
    security: { ...defaultSettings.security, ...partial?.security },
    notifications: partial?.notifications ?? defaultSettings.notifications,
    appearance: { ...defaultSettings.appearance, ...partial?.appearance },
    dataPrivacy: { ...defaultSettings.dataPrivacy, ...partial?.dataPrivacy },
  };
}

const defaultState: WorkspaceState = {
  onboardingDraft: defaultOnboardingDraft,
  chatTargetAgentId: null,
  graphFocusAgentId: null,
  selectedCommandId: null,
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Schema version for the workspace blob in localStorage. Bump when the
 * shape of `WorkspaceState` changes incompatibly so old blobs get
 * dropped instead of merged into the new shape (which would crash on
 * the first read of a renamed/typed field). UI prefs are cheap to
 * lose; correctness is not.
 */
const STORAGE_VERSION = 1;

function readState(): WorkspaceState {
  if (typeof globalThis.window === 'undefined') {
    return defaultState;
  }

  let raw: string | null;
  try {
    raw = globalThis.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    // Storage access can throw in private mode / sandboxed iframes.
    console.warn('[workspace] localStorage unavailable', error);
    return defaultState;
  }
  if (!raw) {
    return defaultState;
  }

  let parsed: Partial<WorkspaceState> & { __v?: number };
  try {
    parsed = JSON.parse(raw) as Partial<WorkspaceState> & { __v?: number };
  } catch (error) {
    console.warn('[workspace] persisted blob is not JSON; resetting', error);
    try {
      globalThis.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return defaultState;
  }

  if (parsed.__v !== STORAGE_VERSION) {
    // Schema mismatch — drop the blob rather than merge it. Better to
    // lose UI prefs than render a broken page.
    try {
      globalThis.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return defaultState;
  }

  return {
    ...defaultState,
    ...parsed,
    onboardingDraft: { ...defaultOnboardingDraft, ...parsed.onboardingDraft },
  };
}

export function WorkspaceProvider({ children }: { readonly children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(() => readState());
  const { setTheme } = useTheme();
  const settingsQuery = useSettingsData();
  const appearance = settingsQuery.data?.appearance ?? defaultSettings.appearance;
  const defaultModel = settingsQuery.data?.defaultModel ?? defaultSettings.defaultModel;

  useEffect(() => {
    if (typeof globalThis.window === 'undefined') {
      return;
    }

    try {
      globalThis.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...state, __v: STORAGE_VERSION }),
      );
    } catch (error) {
      console.error('Failed to save workspace state', error);
    }
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
      defaultModel,
    }),
    [
      state,
      updateOnboardingDraft,
      resetOnboardingDraft,
      setChatTargetAgentId,
      setGraphFocusAgentId,
      setSelectedCommandId,
      defaultModel,
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
