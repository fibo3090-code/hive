import { useEffect, useMemo, useState } from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLlmProviders, useProviderModels, type LlmProvider } from '@/api/llm';

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

interface ModelPickerProps {
  readonly value: ModelSelection | null;
  readonly onChange: (value: ModelSelection | null) => void;
  readonly className?: string;
  readonly disabled?: boolean;
}

export function ModelPicker({ value, onChange, className, disabled }: ModelPickerProps) {
  const providersQuery = useLlmProviders();
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(value?.providerId ?? null);
  const connectedProviders = useMemo(
    () => (providersQuery.data ?? []).filter((p: LlmProvider) => p.connected),
    [providersQuery.data],
  );

  useEffect(() => {
    if (value?.providerId) {
      setSelectedProviderId(value.providerId);
    } else if (!selectedProviderId && connectedProviders.length > 0) {
      setSelectedProviderId(connectedProviders[0].id);
    }
  }, [value?.providerId, selectedProviderId, connectedProviders]);

  const activeProviderId = selectedProviderId ?? value?.providerId ?? connectedProviders[0]?.id ?? null;
  const modelsQuery = useProviderModels(activeProviderId);
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const hasValidSelection =
    value?.providerId === activeProviderId && models.some((model) => model.id === value.modelId);

  useEffect(() => {
    if (!activeProviderId) {
      if (value) onChange(null);
      return;
    }
    if (models.length > 0 && !hasValidSelection) {
      onChange({ providerId: activeProviderId, modelId: models[0].id });
    }
  }, [activeProviderId, hasValidSelection, models, onChange, value]);

  if (providersQuery.isLoading) {
    return <div className={cn('text-xs text-muted-foreground', className)}>Loading providers…</div>;
  }

  if (connectedProviders.length === 0) {
    return (
      <div className={cn('rounded-md border border-border bg-surface-2 p-3 text-xs text-muted-foreground', className)}>
        No connected providers. Add an API key in Settings → LLM, or start Ollama locally.
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {connectedProviders.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => setSelectedProviderId(p.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs border transition-colors',
              activeProviderId === p.id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      {modelsQuery.isLoading && <div className="text-xs text-muted-foreground">Fetching models…</div>}
      {modelsQuery.isError && (
        <div className="text-xs text-destructive">
          Failed to list models: {(modelsQuery.error as Error).message}
          <button
            type="button"
            className="ml-2 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => modelsQuery.refetch()}
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {models.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={disabled}
              onClick={() => activeProviderId && onChange({ providerId: activeProviderId, modelId: m.id })}
              className={cn(
                'flex items-center gap-1 rounded-md px-3 py-1.5 text-xs border transition-colors',
                value?.modelId === m.id && value.providerId === activeProviderId
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
              title={m.contextWindow ? `${m.contextWindow.toLocaleString()} ctx` : undefined}
            >
              <Cpu className="h-3 w-3" />
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
