/**
 * Onboarding step 3 of 6 (Phase 2 of the redesign): connect LLM
 * providers BEFORE the CEO chat. The CEO needs at least one working
 * model — surfacing the keys here means the next step ("Describe via
 * CEO chat") doesn't silently fail with "no provider configured".
 *
 * Wraps the same `useLlmProviders` / `useSetProviderKey` / `useTestProvider`
 * the Settings page uses, so the credential storage path is one
 * implementation, exercised the same way in onboarding and Settings.
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Plug, XCircle } from 'lucide-react';
import {
  type LlmProvider,
  useLlmProviders,
  useSetProviderKey,
  useTestProvider,
} from '@/api/llm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface StepConnectLlmsProps {
  /** Provider ids the user has confirmed during this onboarding run.
   *  We keep this in `onboardingDraft` so a refresh doesn't lose
   *  progress and the wizard can gate "Next" on it. */
  readonly connectedProviderIds: string[];
  readonly onChange: (ids: string[]) => void;
}

export function StepConnectLlms({ connectedProviderIds, onChange }: StepConnectLlmsProps) {
  const providers = useLlmProviders();
  const items = providers.data ?? [];

  // Keep the draft in sync with reality: once a provider becomes
  // `configured`, surface it as connected without requiring a user
  // click. (Settings page may have already set the key.)
  useEffect(() => {
    const data = providers.data ?? [];
    const fresh = data
      .filter((p) => p.connected)
      .map((p) => p.id)
      .sort((a, b) => a.localeCompare(b));
    const current = [...connectedProviderIds].sort((a, b) => a.localeCompare(b));
    if (fresh.join('|') !== current.join('|')) {
      onChange(fresh);
    }
  }, [providers.data, connectedProviderIds, onChange]);

  const noneConnected = items.filter((p) => p.connected).length === 0;

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h2 className="text-display-sm">Connect your LLM providers</h2>
        <p className="text-sm text-muted-foreground">
          The CEO agent in the next step needs at least one working model.
          Keys are encrypted at rest with ChaCha20-Poly1305.
        </p>
      </header>

      {noneConnected && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2 text-xs text-warning">
          No provider connected yet. Add at least one key below to advance.
        </div>
      )}

      <div className="space-y-3">
        {providers.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
          </div>
        ) : (
          items.map((provider) => <ProviderRow key={provider.id} provider={provider} />)
        )}
      </div>
    </div>
  );
}

function ProviderRow({ provider }: { readonly provider: LlmProvider }) {
  const setKey = useSetProviderKey();
  const testProvider = useTestProvider();
  const [draftKey, setDraftKey] = useState('');
  const [editing, setEditing] = useState(!provider.connected);

  const status = useMemo(() => {
    if (testProvider.variables === provider.id && testProvider.isPending) {
      return { kind: 'testing' as const, label: 'Testing…' };
    }
    if (provider.connected) {
      return { kind: 'connected' as const, label: provider.maskedKey ?? 'configured' };
    }
    return { kind: 'unset' as const, label: 'Not configured' };
  }, [provider, testProvider]);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border bg-card p-3',
        status.kind === 'connected'
          ? 'border-success/40'
          : status.kind === 'testing'
            ? 'border-info/40'
            : 'border-border',
      )}
    >
      <div className="flex flex-1 items-center gap-3">
        <Plug
          className={cn(
            'h-4 w-4',
            status.kind === 'connected' ? 'text-success' : 'text-muted-foreground',
          )}
        />
        <div>
          <div className="text-sm font-semibold">{provider.name ?? provider.id}</div>
          <div className="text-[11px] text-muted-foreground">{status.label}</div>
        </div>
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          <Input
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder={`${provider.id} key`}
            className="h-8 w-48 text-xs"
          />
          <Button
            size="sm"
            disabled={draftKey.trim().length < 4 || setKey.isPending}
            onClick={async () => {
              await setKey.mutateAsync({
                providerId: provider.id,
                apiKey: draftKey.trim(),
              });
              setDraftKey('');
              setEditing(false);
              await testProvider.mutateAsync(provider.id);
            }}
          >
            {setKey.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          {provider.connected && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {status.kind === 'connected' && (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          {status.kind !== 'connected' && status.kind !== 'testing' && (
            <XCircle className="h-4 w-4 text-muted-foreground" />
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="gap-1">
            <KeyRound className="h-3 w-3" />
            {provider.connected ? 'Replace' : 'Add key'}
          </Button>
          {provider.connected && (
            <Button
              size="sm"
              variant="ghost"
              disabled={testProvider.isPending}
              onClick={() => testProvider.mutate(provider.id)}
            >
              {testProvider.isPending && testProvider.variables === provider.id
                ? 'Testing…'
                : 'Test'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
