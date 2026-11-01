import { describe, expect, it, vi } from 'vitest';
import {
  chapterFileName,
  concatMp3,
  exportAudiobook,
  id3Tag,
  mp3DurationMs,
} from '@/services/tts/audiobookExport';
import type { DownloadChapter } from '@/services/tts/downloadChapters';

const frame = (fill: number) => new Uint8Array([0xff, 0xfb, fill, fill]);

const withId3 = (frames: Uint8Array) => {
  // A 4-byte tag body (syncsafe size 4) before the frames.
  const out = new Uint8Array(14 + frames.length);
  out.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);
  out.set(frames, 14);
  return out.buffer;
};

const chapter = (label: string, startSection: number, endSection: number): DownloadChapter => ({
  key: label,
  label,
  depth: 0,
  startSection,
  endSection,
});

describe('concatMp3', () => {
  it('joins MP3 segments back to back without their ID3 tags', () => {
    const joined = concatMp3([withId3(frame(1)), frame(2).buffer as ArrayBuffer]);
    expect([...joined]).toEqual([...frame(1), ...frame(2)]);
  });

  it('refuses audio that is not MP3', () => {
    const wav = new TextEncoder().encode('RIFF....WAVE').buffer as ArrayBuffer;
    expect(() => concatMp3([wav])).toThrow(/MP3/);
  });
});

describe('id3Tag', () => {
  it('writes an ID3v2.3 header whose size covers its frames', () => {
    const tag = id3Tag({ title: 'One', album: 'Book', artist: 'Ann', track: 1, total: 2 });
    expect([...tag.subarray(0, 4)]).toEqual([0x49, 0x44, 0x33, 3]);
    const size = (tag[6]! << 21) | (tag[7]! << 14) | (tag[8]! << 7) | tag[9]!;
    expect(size).toBe(tag.length - 10);
    expect(new TextDecoder().decode(tag)).toContain('TIT2');
    expect(new TextDecoder().decode(tag)).toContain('TRCK');
  });
});

describe('chapterFileName', () => {
  it('numbers chapters so they sort, and drops characters file systems refuse', () => {
    expect(chapterFileName(2, 12, 'Part 1: The Storm?')).toBe('03 - Part 1 The Storm.mp3');
    expect(chapterFileName(0, 120, 'Intro')).toBe('001 - Intro.mp3');
    expect(chapterFileName(4, 9, '  ')).toBe('05.mp3');
  });
});

describe('exportAudiobook', () => {
  it('writes one tagged MP3 per chapter from its sections, in reading order', async () => {
    const sentences: Record<number, { lang: string; text: string }[]> = {
      0: [{ lang: 'en', text: 'a' }],
      1: [{ lang: 'en', text: 'b' }],
      2: [{ lang: 'en', text: 'c' }],
    };
    const fills: Record<string, number> = { a: 1, b: 2, c: 3 };
    const written: [string, Uint8Array][] = [];
    const progress = vi.fn();
    await exportAudiobook(
      [chapter('One', 0, 2), chapter('Two', 2, 3)],
      {
        sentencesOf: async (section) => sentences[section] ?? null,
        audioOf: async ({ text }) => frame(fills[text]!).buffer as ArrayBuffer,
      },
      { title: 'Book', author: 'Ann' },
      async (name, data) => {
        written.push([name, data]);
      },
      progress,
    );

    expect(written.map(([name]) => name)).toEqual(['01 - One.mp3', '02 - Two.mp3']);
    const [, first] = written[0]!;
    const tag = id3Tag({ title: 'One', album: 'Book', artist: 'Ann', track: 1, total: 2 });
    expect([...first.subarray(0, tag.length)]).toEqual([...tag]);
    expect([...first.subarray(tag.length)]).toEqual([...frame(1), ...frame(2)]);
    expect(progress).toHaveBeenLastCalledWith({ chapter: 2, total: 2 });
  });

  it('stops without writing more once aborted', async () => {
    const abort = new AbortController();
    const write = vi.fn();
    await exportAudiobook(
      [chapter('One', 0, 1), chapter('Two', 1, 2)],
      {
        sentencesOf: async () => [{ lang: 'en', text: 'a' }],
        audioOf: async () => {
          abort.abort();
          return frame(1).buffer as ArrayBuffer;
        },
      },
      { title: 'Book', author: '' },
      write,
      undefined,
      abort.signal,
    );
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('mp3DurationMs', () => {
  it('adds up MPEG-1 frames after a leading ID3 tag', () => {
    const bytes = new Uint8Array(14 + 417 * 100);
    bytes.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4]);
    for (let i = 0; i < 100; i++) bytes.set([0xff, 0xfb, 0x90, 0x00], 14 + i * 417);
    expect(mp3DurationMs(bytes)).toBe(Math.round((100 * 1152 * 1000) / 44100));
  });

  it('reads MPEG-2 frames, which carry half the samples', () => {
    // 48 kbps, 24 kHz (Edge's format): 144-byte frames of 576 samples.
    const bytes = new Uint8Array(144 * 50);
    for (let i = 0; i < 50; i++) bytes.set([0xff, 0xf3, 0x64, 0x00], i * 144);
    expect(mp3DurationMs(bytes)).toBe(Math.round((50 * 576 * 1000) / 24000));
  });
});
