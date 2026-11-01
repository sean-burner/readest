import { useEffect, useRef } from 'react';

import { useBookDataStore } from '@/store/bookDataStore';
import { useBookCodexStore } from '@/store/bookCodexStore';
import { getBookProgress, useBookProgress } from '@/store/readerProgressStore';
import { collectNewText, MIN_AUTO_UPDATE_CHARS } from '@/services/ai/codex/codexService';
import { useSettingsStore } from '@/store/settingsStore';

/** Wait this long in a new chapter before updating, so quick skims through chapters don't. */
const SETTLE_MS = 4000;

/**
 * Builds the Book Notes after each chapter the reader finishes. It fires only
 * when reading moves on to the next chapter by turning pages, not on jumps
 * through the table of contents, so skipped chapters never reach the notes.
 */
export const useBookCodexAutoUpdate = (bookKey: string | null) => {
  const progress = useBookProgress(bookKey);
  const aiSettings = useSettingsStore((s) => s.settings?.aiSettings);
  const lastSectionRef = useRef<number | null>(null);

  const sectionIndex = progress?.section?.current ?? null;
  const enabled = !!aiSettings?.enabled && (aiSettings.codexAutoUpdate ?? true);

  useEffect(() => {
    lastSectionRef.current = null;
  }, [bookKey]);

  useEffect(() => {
    if (sectionIndex === null) return;
    const previous = lastSectionRef.current;
    lastSectionRef.current = sectionIndex;
    if (!enabled || !bookKey || previous === null || sectionIndex !== previous + 1) return;

    const timer = setTimeout(async () => {
      const bookData = useBookDataStore.getState().getBookData(bookKey);
      const latest = getBookProgress(bookKey);
      const settings = useSettingsStore.getState().settings?.aiSettings;
      if (!bookData?.bookDoc || !latest || !settings) return;
      if (latest.section?.current !== sectionIndex) return;
      const bookHash = bookKey.split('-')[0]!;
      const store = useBookCodexStore.getState();
      const codex = await store.load(bookHash);
      // Only continue notes that already reach the chapter just finished.
      // Catching up on chapters read before the notes were turned on is the
      // reader's call (it can be many requests).
      const backlog = await collectNewText(bookData.bookDoc, codex.processedUpTo, {
        sectionIndex: previous,
        sectionFraction: 0,
        bookFraction: 0,
      });
      if (backlog.reduce((n, seg) => n + seg.text.length, 0) > MIN_AUTO_UPDATE_CHARS) return;
      await store.startUpdate({
        bookHash,
        bookDoc: bookData.bookDoc,
        bookTitle: bookData.book?.title || '',
        authorName: bookData.book?.author || '',
        settings,
        progress: latest,
        upTo: 'chapter',
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [bookKey, sectionIndex, enabled]);
};
