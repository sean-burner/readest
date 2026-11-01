import { describe, expect, it, vi } from 'vitest';
import { generatePairedAudiobook } from '@/services/tts/generateAudiobook';
import type { DownloadChapter } from '@/services/tts/downloadChapters';
import type { PairedAudiobook } from '@/types/book';

// MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417-byte frames of 1152 samples.
const mp3 = (frameCount: number) => {
  const out = new Uint8Array(417 * frameCount);
  for (let i = 0; i < frameCount; i++) out.set([0xff, 0xfb, 0x90, 0x00], i * 417);
  return out.buffer;
};

const chapter = (key: string, label: string, start: number): DownloadChapter => ({
  key,
  label,
  depth: 0,
  startSection: start,
  endSection: start + 1,
});

const storage = () => ({
  createDir: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  deleteDir: vi.fn(async () => {}),
});

const source = {
  sentencesOf: async () => [{ lang: 'en', text: 'a' }],
  audioOf: async () => mp3(100),
};

describe('generatePairedAudiobook', () => {
  it('writes one MP3 per chapter into the book and pairs each with its TOC entry', async () => {
    const fs = storage();
    const persist = vi.fn(async () => {});
    const result = (await generatePairedAudiobook(
      fs,
      'hash',
      [chapter('ch1.xhtml', 'One', 0), chapter('ch2.xhtml', 'Two', 1)],
      source,
      { title: 'Book', author: 'Ann', narrator: 'Rachel' },
      undefined,
      persist,
    ))!;

    const seconds = (100 * 1152) / 44100;
    expect(fs.createDir).toHaveBeenCalledWith('hash/audiobook', 'Books', true);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(result.files.map((f) => f.name)).toEqual(['01 - One.mp3', '02 - Two.mp3']);
    expect(result.files[0]!.path).toMatch(/^hash\/audiobook\/\d+-01 - One\.mp3$/);
    expect(result.files[0]!.duration).toBeCloseTo(seconds, 2);
    expect(result.chapters[1]).toMatchObject({
      fileId: result.files[1]!.id,
      label: 'Two',
      start: 0,
    });
    expect(result.mappings).toEqual([
      { ebookChapterId: 'ch1.xhtml', audioChapterId: result.files[0]!.id },
      { ebookChapterId: 'ch2.xhtml', audioChapterId: result.files[1]!.id },
    ]);
    expect(result).toMatchObject({ title: 'Book', narrator: 'Rachel' });
    expect(persist).toHaveBeenCalledWith(result);
  });

  it('removes the files of the audiobook it replaces', async () => {
    const fs = storage();
    const previous = {
      version: 1,
      files: [{ id: 'old', name: 'old.mp3', path: 'hash/audiobook/1-old.mp3', duration: 1 }],
      chapters: [],
      mappings: [],
      createdAt: 1,
    } as PairedAudiobook;
    await generatePairedAudiobook(
      fs,
      'hash',
      [chapter('ch1.xhtml', 'One', 0)],
      source,
      { title: 'Book', author: '' },
      previous,
      async () => {},
    );
    expect(fs.deleteFile).toHaveBeenCalledWith('hash/audiobook/1-old.mp3', 'Books');
  });

  it('keeps the old audiobook and deletes what it wrote when stopped', async () => {
    const fs = storage();
    const abort = new AbortController();
    const persist = vi.fn(async () => {});
    const result = await generatePairedAudiobook(
      fs,
      'hash',
      [chapter('ch1.xhtml', 'One', 0), chapter('ch2.xhtml', 'Two', 1)],
      {
        sentencesOf: source.sentencesOf,
        audioOf: async () => {
          abort.abort();
          return mp3(10);
        },
      },
      { title: 'Book', author: '' },
      undefined,
      persist,
      undefined,
      abort.signal,
    );
    expect(result).toBeNull();
    expect(persist).not.toHaveBeenCalled();
    expect(fs.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('does not map section rows of a book without a table of contents', async () => {
    const result = await generatePairedAudiobook(
      storage(),
      'hash',
      [chapter('section-0', 'Section 1', 0)],
      source,
      { title: 'Book', author: '' },
      undefined,
      async () => {},
    );
    expect(result?.mappings).toEqual([]);
  });
});
