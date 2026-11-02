// Generate a book's audiobook from its Read Aloud voice and attach it as the
// book's paired audiobook, so Readest's own audiobook player and read-along
// play it like an imported one. Each chapter becomes one MP3 under the book's
// audiobook folder, written as soon as it is made so a whole book never sits
// in memory; the pairing maps each to its table-of-contents entry.

import type { AudiobookChapter, AudiobookFile, PairedAudiobook } from '@/types/book';
import {
  type AudiobookStorage,
  deleteAudiobookFiles,
  getAudiobookDirectory,
} from '@/services/audiobook/storage';
import {
  type AudiobookExportProgress,
  type AudiobookMeta,
  type AudiobookSource,
  exportAudiobook,
  mp3DurationMs,
} from './audiobookExport';
import type { DownloadChapter } from './downloadChapters';
import { makeSafeFilename } from '@/utils/misc';

export const generatePairedAudiobook = async (
  storage: AudiobookStorage,
  bookHash: string,
  chapters: DownloadChapter[],
  source: AudiobookSource,
  meta: AudiobookMeta,
  previous: PairedAudiobook | undefined,
  persist: (association: PairedAudiobook) => Promise<void>,
  onProgress?: (progress: AudiobookExportProgress) => void,
  signal?: AbortSignal,
): Promise<PairedAudiobook | null> => {
  const directory = getAudiobookDirectory(bookHash);
  await storage.createDir(directory, 'Books', true);
  const createdAt = Math.max(Date.now(), (previous?.createdAt ?? 0) + 1);
  const files: AudiobookFile[] = [];
  const audioChapters: AudiobookChapter[] = [];
  const mappings: PairedAudiobook['mappings'] = [];
  try {
    await exportAudiobook(
      chapters,
      source,
      meta,
      async (name, data, chapter) => {
        const id = `generated-${files.length + 1}`;
        // The same file name rules as an imported audiobook (no '%' or '#', which break URLs).
        const path = `${directory}/${createdAt}-${makeSafeFilename(name)}`;
        await storage.writeFile(path, 'Books', data.slice().buffer);
        const duration = mp3DurationMs(data) / 1000;
        files.push({ id, name, path, duration });
        audioChapters.push({ id, fileId: id, label: chapter.label, start: 0, end: duration });
        // A book without a table of contents has section rows, which no
        // ebook chapter id names.
        if (!chapter.key.startsWith('section-')) {
          mappings.push({ ebookChapterId: chapter.key, audioChapterId: id });
        }
      },
      onProgress,
      signal,
    );
    if (signal?.aborted || !files.length) throw new DOMException('Aborted', 'AbortError');
    const association: PairedAudiobook = {
      version: 1,
      title: meta.title,
      ...(meta.narrator ? { narrator: meta.narrator } : {}),
      files,
      chapters: audioChapters,
      mappings,
      createdAt,
    };
    await persist(association);
    const kept = new Set(files.map((file) => file.path));
    await deleteAudiobookFiles(
      storage,
      bookHash,
      (previous?.files ?? []).filter((file) => !kept.has(file.path)),
    ).catch((error) => console.warn('Failed to remove replaced audiobook files:', error));
    return association;
  } catch (error) {
    await Promise.allSettled(files.map((file) => storage.deleteFile(file.path, 'Books')));
    if (signal?.aborted) return null;
    throw error;
  }
};
