export type DraftSaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';
/** Serializes saves, retries a lost acknowledgement with the same key, and drains newer edits. */
export function createDraftSaver(options: {
  id: string; revision: number;
  request?: typeof fetch;
  onState: (state: DraftSaveState, error?: string) => void;
  onSaved?: (revision: number) => void;
}) {
  let revision = options.revision;
  let latest = '';
  let saved = '';
  let attempt: { payload: string; saveId: string; revision: number } | null = null;
  let running: Promise<boolean> | null = null;
  let stopped = false;
  function update(payload: string, initial = false) {
    latest = payload;
    if (initial) saved = payload;
    if (!stopped && latest !== saved) options.onState('unsaved');
  }
  async function drain(): Promise<boolean> {
    while (!stopped && (latest !== saved || attempt)) {
      attempt ??= { payload: latest, saveId: crypto.randomUUID(), revision };
      options.onState('saving');
      try {
        const response = await (options.request ?? fetch)('/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...JSON.parse(attempt.payload), id: options.id, saveId: attempt.saveId, revision: attempt.revision }) });
        const body = await response.json() as { id?: string; revision?: number; error?: string };
        if (!response.ok || body.id !== options.id || !Number.isSafeInteger(body.revision)) throw new Error(body.error || 'Draft could not be saved');
        saved = attempt.payload;
        revision = body.revision!;
        attempt = null;
        options.onSaved?.(revision);
      } catch (error) {
        options.onState('error', error instanceof Error ? error.message : 'Draft could not be saved');
        return false;
      }
    }
    if (!stopped) options.onState('saved');
    return true;
  }
  return {
    update,
    get dirty() { return latest !== saved || Boolean(attempt); },
    flush() {
      if (stopped) return Promise.resolve(true);
      if (!running) running = drain().finally(() => { running = null; });
      return running;
    },
    stop() { stopped = true; }
  };
}
