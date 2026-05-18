import { useCallback, useRef, useState } from 'react';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';

interface ConfirmRequest {
  readonly title: string;
  readonly description: string;
}

/**
 * Imperative replacement for `window.confirm()` that uses our shadcn
 * `<AlertDialog>` styling and respects keyboard focus. Returns a
 * `[modal, confirm]` pair: mount `modal` once in your JSX, then call
 * `await confirm({title, description})` from any event handler. Resolves
 * `true` on the destructive action, `false` on cancel/dismiss.
 *
 * Use this everywhere we'd previously have written
 * `if (!window.confirm(...)) return;` — `window.confirm` blocks the JS
 * thread, ignores theme, and can't be styled or made consistent across
 * the app.
 */
export function useConfirmDelete(): readonly [
  React.ReactNode,
  (req: ConfirmRequest) => Promise<boolean>,
] {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (req: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setRequest(req);
        setOpen(true);
      }),
    [],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next && resolverRef.current) {
      // Closing without confirming counts as cancel.
      resolverRef.current(false);
      resolverRef.current = null;
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
    setOpen(false);
  }, []);

  const modal = request ? (
    <ConfirmDeleteModal
      open={open}
      onOpenChange={handleOpenChange}
      title={request.title}
      description={request.description}
      onConfirm={handleConfirm}
    />
  ) : null;

  return [modal, confirm] as const;
}
