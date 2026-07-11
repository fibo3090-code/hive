import { useState } from 'react';
import { api } from '@/api/client';
import { useHiveData } from '@/api/queries/useHiveData';
import { useSpecDocument, useSpecDocuments, useSpecDocumentSections } from '@/api/spec-documents';
import { useDriftEvents, useUpdateDriftStatus } from '@/api/drift';
import { usePlanGraph, useSavePlanGraph } from '@/api/planGraph';
import type { PlanGraphPayload } from '@/api/planGraph';
import {
  useTechDebtData,
  useMoveTechDebt,
  useNotesData,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useUpdateTechDebt,
  useDeleteTechDebt,
} from '@/api/queries/useServerData';
import type { TechDebtItem, NoteItem } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirmDelete } from '@/components/shared/useConfirmDelete';
import { SprintPlanExplorer } from '@/components/planning/SprintPlanExplorer';

type Tab = 'spec' | 'sprint' | 'techdebt' | 'hivemind' | 'drift';

const tabLabels: Record<Tab, string> = {
  spec: 'Spec Document',
  sprint: 'Skill Sprint',
  techdebt: 'Tech Debt',
  hivemind: 'Hive Mind',
  drift: 'Drift',
};

function EmptyState({ title, message }: { readonly title: string; readonly message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/60 p-8 text-center">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export default function Planning() {
  const [tab, setTab] = useState<Tab>('spec');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        {(Object.keys(tabLabels) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            )}
          >
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {tab === 'spec' && <SpecDocumentTab />}
      {tab === 'sprint' && <SkillSprintTab />}
      {tab === 'techdebt' && <TechDebtTab />}
      {tab === 'hivemind' && <HiveMindTab />}
      {tab === 'drift' && <DriftAndDelaysTab />}
    </div>
  );
}

// ─── Spec Document tab ─────────────────────────────────────────────────

function SpecDocumentTab() {
  const { activeProject } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const docs = useSpecDocuments(activeProjectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? docs.data?.[0]?.id ?? null;
  const selectedDoc = useSpecDocument(effectiveId);
  const sections = useSpecDocumentSections(effectiveId);
  const [decomposing, setDecomposing] = useState(false);

  const handleDecompose = async () => {
    if (!effectiveId) return;
    setDecomposing(true);
    try {
      const result = await api<{ taskCount: number; sprintIds: string[] }>(
        `/v1/spec-documents/${effectiveId}/auto-decompose`,
        { method: 'POST' },
      );
      toast.success(`Decomposed into ${result.sprintIds.length} sprint(s) and ${result.taskCount} task(s) — see Planning → Skill Sprint.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Decomposition failed (a connected LLM provider is required).');
    } finally {
      setDecomposing(false);
    }
  };

  if (!docs.data?.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No spec document yet. The CEO conversation in onboarding produces one
        automatically; otherwise you can create one from the API.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <aside className="col-span-3 space-y-2">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Documents</h3>
        {docs.data.map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => setSelectedId(doc.id)}
            className={cn(
              'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
              effectiveId === doc.id
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-surface-2',
            )}
          >
            <div className="truncate font-medium">{doc.title}</div>
            <div className="text-[10px] text-muted-foreground">
              v{doc.version} · {doc.source}
            </div>
          </button>
        ))}
        
        <Button variant="outline" className="w-full mt-4 text-xs h-8" onClick={() => { void handleDecompose(); }} disabled={decomposing || !effectiveId}>
          {decomposing ? 'Decomposing…' : 'Decompose Spec'}
        </Button>
      </aside>

      <main className="col-span-9 space-y-4">
        {sections.data?.length ? (
          sections.data.map((section) => (
            <section
              key={section.id}
              id={`section-${section.anchor}`}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-sm font-semibold">{section.title}</h4>
                <code className="text-[10px] text-muted-foreground">#{section.anchor}</code>
              </div>
              {section.body && (
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{section.body}</pre>
              )}
            </section>
          ))
        ) : (
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">{selectedDoc.data?.title ?? 'Spec document'}</h4>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                raw markdown
              </span>
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
              {selectedDoc.data?.markdown?.trim() || 'This document has no parsed sections yet.'}
            </pre>
          </section>
        )}
      </main>
    </div>
  );
}

// ─── Skill Sprint tab ──────────────────────────────────────────────────

function SkillSprintTab() {
  const { activeProject, createTask, state } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const planGraph = usePlanGraph(activeProjectId);
  const savePlanGraph = useSavePlanGraph(activeProjectId);
  const [draftPlan, setDraftPlan] = useState<PlanGraphPayload | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAgent, setNewTaskAgent] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  const effectivePlan = draftPlan ?? planGraph.data ?? null;

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) {
      toast.error('Please enter a task title.');
      return;
    }
    if (!activeProjectId) {
      toast.error('No active project.');
      return;
    }
    setSavingTask(true);
    try {
      await createTask({
        title: newTaskTitle.trim(),
        agentId: newTaskAgent.trim() || undefined,
      });
      toast.success(newTaskAgent.trim() ? `Task created and assigned to ${newTaskAgent.trim()}.` : 'Task created.');
      setCreatingTask(false);
      setNewTaskTitle('');
      setNewTaskAgent('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create task.');
    } finally {
      setSavingTask(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setCreatingTask(!creatingTask)}
          className="flex items-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Manual Task
        </Button>
        {effectivePlan && (
          <Button
            size="sm"
            onClick={() => savePlanGraph.mutate(effectivePlan)}
            disabled={savePlanGraph.isPending}
          >
            {savePlanGraph.isPending ? 'Saving…' : 'Save Graph'}
          </Button>
        )}
      </div>

      {creatingTask && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3 mb-4">
          <h3 className="text-sm font-semibold">Assign a New Task</h3>
          <div className="grid grid-cols-2 gap-4">
            <input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Task description or ID"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm"
            />
            <input
              value={newTaskAgent}
              onChange={(e) => setNewTaskAgent(e.target.value)}
              placeholder="Agent ID (e.g. backend-engineer)"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => setCreatingTask(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreateTask} disabled={savingTask}>{savingTask ? 'Creating…' : 'Create Task'}</Button>
          </div>
        </div>
      )}

      {effectivePlan && effectivePlan.sprintNodes.length > 0 ? (
        <SprintPlanExplorer
          plan={effectivePlan}
          agents={state.agents}
          editable
          onChange={setDraftPlan}
          onSave={() => savePlanGraph.mutate(effectivePlan)}
          saving={savePlanGraph.isPending}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No sprint graph yet. Run the doc→sprint decomposition or launch a project from onboarding.
        </div>
      )}
    </div>
  );
}

// ─── Tech Debt tab ──────────────────────────────────────────────────────

function TechDebtTab() {
  const { activeProject } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const techDebtQuery = useTechDebtData(activeProjectId);
  const moveMutation = useMoveTechDebt(activeProjectId);
  const updateMutation = useUpdateTechDebt(activeProjectId);
  const deleteMutation = useDeleteTechDebt(activeProjectId);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editImpact, setEditImpact] = useState('');
  const [confirmModal, confirmDelete] = useConfirmDelete();

  const items = (techDebtQuery.data ?? []) as TechDebtItem[];
  const columns = ['high', 'medium', 'low'] as const;
  const colors: Record<typeof columns[number], string> = {
    high: 'text-destructive',
    medium: 'text-warning',
    low: 'text-info',
  };

  const handleDrop = async (severity: string) => {
    if (!draggedId) return;

    try {
      await moveMutation.mutateAsync({ itemId: draggedId, severity });
      toast.success('Tech debt item moved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to move tech debt item');
    } finally {
      setDraggedId(null);
    }
  };

  const startEdit = (item: TechDebtItem) => {
    setEditingId(item.id);
    setEditTitle(item.title ?? '');
    setEditDescription(item.description ?? '');
    setEditImpact(item.impact ?? '');
  };

  const saveEdit = async (itemId: string) => {
    if (!editTitle.trim()) {
      toast.error('Title is required');
      return;
    }
    try {
      await updateMutation.mutateAsync({
        itemId,
        patch: {
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          impact: editImpact.trim() || null,
        },
      });
      toast.success('Tech debt item updated');
      setEditingId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update item');
    }
  };

  const handleDelete = async (item: TechDebtItem) => {
    const ok = await confirmDelete({
      title: 'Delete tech debt item?',
      description: `Permanently delete "${item.title}". This cannot be undone.`,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(item.id);
      toast.success('Tech debt item deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete item');
    }
  };

  return (
    <div className="space-y-4">
      {confirmModal}
      {items.length === 0 ? (
        <EmptyState title="No tech debt recorded" message="Tech debt items will appear here when the backend has findings for the active project." />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {columns.map((column) => (
            <div key={column} onDragOver={(event) => event.preventDefault()} onDrop={() => void handleDrop(column)}>
              <h4 className={cn('text-xs font-semibold uppercase mb-3', colors[column])}>{column} Priority</h4>
              <div className="space-y-2 min-h-[220px] rounded-lg border border-dashed border-border/60 p-2">
                {items
                  .filter((item: TechDebtItem) => item.severity === column)
                  .map((item: TechDebtItem) =>
                    editingId === item.id ? (
                      <div key={item.id} className="rounded-lg border border-primary/40 bg-card p-3 space-y-2">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Title"
                          className="w-full h-8 rounded-md border border-border bg-surface-2 px-2 text-xs"
                        />
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description"
                          className="w-full rounded-md border border-border bg-surface-2 p-2 text-xs h-16 resize-none"
                        />
                        <input
                          value={editImpact}
                          onChange={(e) => setEditImpact(e.target.value)}
                          placeholder="Impact"
                          className="w-full h-8 rounded-md border border-border bg-surface-2 px-2 text-xs"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-md border border-border px-2 py-1 text-micro"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveEdit(item.id)}
                            disabled={updateMutation.isPending}
                            className="rounded-md bg-primary px-2 py-1 text-micro text-primary-foreground disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => setDraggedId(item.id)}
                        onDragEnd={() => setDraggedId(null)}
                        className="group rounded-lg border border-border bg-card p-3 hover:border-primary/30 cursor-grab active:cursor-grabbing transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h5 className="text-sm font-medium mb-1">{item.title}</h5>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                            <button
                              type="button"
                              aria-label="Edit item"
                              onClick={() => startEdit(item)}
                              className="text-muted-foreground hover:text-foreground p-0.5"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              aria-label="Delete item"
                              onClick={() => void handleDelete(item)}
                              className="text-muted-foreground hover:text-destructive p-0.5"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-micro text-muted-foreground mb-1">{item.description}</p>
                        <p className="text-micro text-muted-foreground italic mb-1">Impact: {item.impact}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-micro font-mono text-muted-foreground">{item.file}</span>
                          {item.lines > 0 && <span className="text-micro text-muted-foreground">{item.lines} lines</span>}
                        </div>
                      </div>
                    ),
                  )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Hive Mind tab ──────────────────────────────────────────────────────

function HiveMindTab() {
  const { activeProject } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const notesQuery = useNotesData(activeProjectId);
  const createNote = useCreateNote(activeProjectId);
  const updateNote = useUpdateNote(activeProjectId);
  const deleteNote = useDeleteNote(activeProjectId);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [confirmModal, confirmDelete] = useConfirmDelete();
  const categories = ['all', 'Architecture', 'Decisions', 'Patterns', 'Issues', 'Auto-generated'];

  const startEdit = (note: NoteItem) => {
    setEditingId(note.id);
    setEditTitle(note.title ?? '');
    setEditContent(note.content ?? '');
  };

  const saveEdit = async (noteId: string) => {
    if (!editTitle.trim() || !editContent.trim()) {
      toast.error('Title and content are required');
      return;
    }
    try {
      await updateNote.mutateAsync({
        noteId,
        patch: { title: editTitle.trim(), content: editContent.trim() },
      });
      toast.success('Note updated');
      setEditingId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update note');
    }
  };

  const handleDelete = async (note: NoteItem) => {
    const ok = await confirmDelete({
      title: 'Delete Hive Mind note?',
      description: `Permanently delete "${note.title}". Agents that recall this note will no longer see it.`,
    });
    if (!ok) return;
    try {
      await deleteNote.mutateAsync(note.id);
      toast.success('Note deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete note');
    }
  };

  const notes = notesQuery.data ?? [];
  const filtered = notes.filter((note: NoteItem) => {
    const categoryMatch = category === 'all' || note.category === category;
    const searchMatch =
      search === '' ||
      note.title?.toLowerCase().includes(search.toLowerCase()) ||
      note.content?.toLowerCase().includes(search.toLowerCase());
    return categoryMatch && searchMatch;
  });

  const submitNote = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;

    try {
      await createNote.mutateAsync({
        category: 'Decisions',
        title: newTitle.trim(),
        content: newContent.trim(),
      });
      toast.success('Hive Mind note added');
      setNewTitle('');
      setNewContent('');
      setCreating(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create note');
    }
  };

  return (
    <div className="space-y-4">
      {confirmModal}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full h-8 rounded-md border border-border bg-surface-2 pl-8 pr-3 text-xs placeholder:text-muted-foreground"
              placeholder="Search notes..."
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[10px] uppercase font-semibold tracking-wider transition-colors',
                  category === item ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => setCreating((value) => !value)}
          className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"
        >
          <Plus className="h-3.5 w-3.5" /> Post Memo
        </button>
      </div>

      {creating && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="Note title"
            className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm"
          />
          <textarea
            value={newContent}
            onChange={(event) => setNewContent(event.target.value)}
            placeholder="Add the key insight or decision..."
            className="w-full rounded-md border border-border bg-surface-2 p-3 text-sm h-24 resize-none"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="rounded-md border border-border px-3 py-2 text-xs">
              Cancel
            </button>
            <button
              onClick={submitNote}
              className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground"
            >
              Add Note
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="No matching notes" message="Create a note or adjust the filters to see saved Hive Mind entries." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filtered.map((note: NoteItem) =>
            editingId === note.id ? (
              <div key={note.id} className="rounded-lg border border-primary/40 bg-card p-4 space-y-2">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Note title"
                  className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm"
                />
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Note content"
                  className="w-full rounded-md border border-border bg-surface-2 p-3 text-sm h-28 resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEdit(note.id)}
                    disabled={updateNote.isPending}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={note.id}
                className={cn(
                  'group rounded-lg border bg-card p-4 hover:border-primary/30 transition-colors flex flex-col',
                  note.auto ? 'border-primary/20' : 'border-border'
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  {note.auto && <span className="text-micro bg-primary/10 text-primary px-1.5 py-0.5 rounded">auto</span>}
                  <span className="text-micro bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground">{note.category}</span>
                  <span className="text-micro text-muted-foreground ml-auto">{note.time}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      aria-label="Edit note"
                      onClick={() => startEdit(note)}
                      className="text-muted-foreground hover:text-foreground p-0.5"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete note"
                      onClick={() => void handleDelete(note)}
                      className="text-muted-foreground hover:text-destructive p-0.5"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <h4 className="text-sm font-semibold mb-2">{note.title}</h4>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4 flex-1">{note.content}</div>
                <div className="mt-3 text-[10px] font-medium text-muted-foreground border-t border-border/50 pt-2">— {note.author}</div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── Drift & Delays tab ────────────────────────────────────────────────

function DriftAndDelaysTab() {
  const { activeProject } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const drift = useDriftEvents(activeProjectId, { openOnly: false });
  const updateDrift = useUpdateDriftStatus(activeProjectId);
  const events = drift.data ?? [];

  if (!events.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No drift events recorded. The runtime detector populates this list as
        agents diverge from their tasks, code from spec, or behaviour from
        system prompt.
      </div>
    );
  }

  const kindLabels: Record<string, string> = {
    'agent-vs-task': 'Agent ⇄ Task',
    'code-vs-spec': 'Code ⇄ Spec',
    'agent-vs-system-prompt': 'Agent ⇄ Prompt',
  };
  const sevColors: Record<string, string> = {
    high: 'text-destructive border-destructive/40',
    medium: 'text-warning border-warning/40',
    low: 'text-info border-info/40',
  };

  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li
          key={e.id}
          className={cn(
            'rounded-lg border bg-card p-3',
            e.status === 'open'
              ? sevColors[e.severity] ?? 'border-border'
              : 'border-border opacity-70',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide">
                {kindLabels[e.kind] ?? e.kind}
                <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-px text-[10px] text-muted-foreground">
                  {e.severity}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {e.subjectKind} · <code className="font-mono">{e.subjectId}</code>
                {' · '}
                {new Date(e.createdAt).toLocaleString()}
                {e.status !== 'open' && (
                  <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-px text-[10px]">
                    {e.status}
                  </span>
                )}
              </div>
            </div>
            {e.status === 'open' ? (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateDrift.mutate({ id: e.id, status: 'approved' })
                  }
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateDrift.mutate({ id: e.id, status: 'corrected' })
                  }
                >
                  Correct
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    updateDrift.mutate({ id: e.id, status: 'dismissed' })
                  }
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
