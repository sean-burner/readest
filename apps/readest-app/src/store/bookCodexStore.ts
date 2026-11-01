import { create } from 'zustand';

import { codexStore } from '@/services/ai/codex/codexStore';
import {
  getSectionFraction,
  MIN_AUTO_UPDATE_CHARS,
  updateCodex,
  type CodexProgress,
  type ReadingTarget,
} from '@/services/ai/codex/codexService';
import { emptyCodex, type BookCodex } from '@/services/ai/codex/types';
import type { AISettings } from '@/services/ai/types';
import type { BookDoc } from '@/libs/document';
import type { BookProgress } from '@/types/book';

export interface CodexRunState {
  running: boolean;
  progress: CodexProgress | null;
  error: string;
}

interface StartUpdateArgs {
  bookHash: string;
  bookDoc: BookDoc;
  bookTitle: string;
  authorName: string;
  settings: AISettings;
  progress: BookProgress;
  /**
   * 'chapter' builds notes up to the start of the current chapter (the
   * automatic update); 'page' includes the current chapter up to this page.
   */
  upTo: 'chapter' | 'page';
}

interface BookCodexState {
  codices: Record<string, BookCodex>;
  runs: Record<string, CodexRunState>;
  load: (bookHash: string) => Promise<BookCodex>;
  startUpdate: (args: StartUpdateArgs) => Promise<void>;
  stopUpdate: (bookHash: string) => void;
  clear: (bookHash: string) => Promise<void>;
}

const controllers = new Map<string, AbortController>();

export const getReadingTarget = (
  bookDoc: BookDoc,
  progress: BookProgress,
  upTo: 'chapter' | 'page',
): ReadingTarget => {
  const sectionIndex = progress.section?.current ?? progress.index ?? 0;
  const bookFraction = progress.fraction ?? 0;
  return {
    sectionIndex,
    sectionFraction:
      upTo === 'chapter' ? 0 : getSectionFraction(bookDoc, sectionIndex, bookFraction),
    bookFraction,
  };
};

export const useBookCodexStore = create<BookCodexState>((set, get) => ({
  codices: {},
  runs: {},

  load: async (bookHash) => {
    const existing = get().codices[bookHash];
    if (existing) return existing;
    const codex = (await codexStore.get(bookHash)) ?? emptyCodex(bookHash);
    set((s) => ({ codices: { ...s.codices, [bookHash]: codex } }));
    return codex;
  },

  startUpdate: async ({ bookHash, bookDoc, bookTitle, authorName, settings, progress, upTo }) => {
    if (get().runs[bookHash]?.running) return;
    const controller = new AbortController();
    controllers.set(bookHash, controller);
    const setRun = (run: Partial<CodexRunState>) =>
      set((s) => ({
        runs: {
          ...s.runs,
          [bookHash]: { running: false, progress: null, error: '', ...s.runs[bookHash], ...run },
        },
      }));
    setRun({ running: true, progress: null, error: '' });
    try {
      await get().load(bookHash);
      await updateCodex({
        bookDoc,
        bookHash,
        bookTitle,
        authorName,
        settings,
        target: getReadingTarget(bookDoc, progress, upTo),
        minChars: upTo === 'chapter' ? MIN_AUTO_UPDATE_CHARS : 0,
        signal: controller.signal,
        onProgress: (p) => setRun({ progress: p }),
        onUpdate: (codex) => set((s) => ({ codices: { ...s.codices, [bookHash]: codex } })),
      });
      setRun({ running: false, progress: null });
    } catch (e) {
      const aborted = controller.signal.aborted;
      setRun({ running: false, progress: null, error: aborted ? '' : (e as Error).message });
    } finally {
      controllers.delete(bookHash);
    }
  },

  stopUpdate: (bookHash) => controllers.get(bookHash)?.abort(),

  clear: async (bookHash) => {
    controllers.get(bookHash)?.abort();
    await codexStore.delete(bookHash);
    set((s) => ({ codices: { ...s.codices, [bookHash]: emptyCodex(bookHash) } }));
  },
}));
