import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  saved: new Map<string, unknown>(),
}));

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: mocks.generateText,
}));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => 'model' }),
}));
vi.mock('@/services/ai/codex/codexStore', () => ({
  codexStore: {
    get: async (hash: string) => mocks.saved.get(hash) ?? null,
    put: async (codex: { bookHash: string }) => void mocks.saved.set(codex.bookHash, codex),
    delete: async (hash: string) => void mocks.saved.delete(hash),
  },
}));

import {
  batchSegments,
  collectNewText,
  getSectionFraction,
  mergeCodexUpdates,
  parseCodexResponse,
  updateCodex,
  buildCodexUserPrompt,
} from '@/services/ai/codex/codexService';
import type { BookDoc } from '@/libs/document';
import type { BookCodex, CodexEntry } from '@/services/ai/codex/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

const makeBook = (texts: string[]): BookDoc =>
  ({
    metadata: { title: 'T' },
    toc: texts.map((_, i) => ({ id: i, label: `Chapter ${i + 1}`, href: `c${i}` })),
    sections: texts.map((text, i) => ({
      id: `s${i}`,
      cfi: '',
      size: text.length,
      linear: 'yes',
      createDocument: async () =>
        new DOMParser().parseFromString(`<html><body><p>${text}</p></body></html>`, 'text/html'),
    })),
  }) as unknown as BookDoc;

const entry = (patch: Partial<CodexEntry>): CodexEntry => ({
  id: 'a1',
  name: 'Ann',
  kind: 'character',
  aliases: [],
  summary: 'A girl.',
  firstSeen: 'Chapter 1',
  updatedAt: 0,
  updatedFraction: 0,
  ...patch,
});

describe('collectNewText', () => {
  test('stops at the reading position inside the current section', async () => {
    const book = makeBook(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)]);
    const segs = await collectNewText(
      book,
      { sectionIndex: 0, charOffset: 40 },
      { sectionIndex: 2, sectionFraction: 0.5, bookFraction: 0.83 },
    );
    expect(segs.map((s) => [s.sectionIndex, s.start, s.end])).toEqual([
      [0, 40, 100],
      [1, 0, 100],
      [2, 0, 50],
    ]);
    expect(segs[2]!.text).toBe('c'.repeat(50));
    expect(segs[1]!.label).toBe('Chapter 2');
  });

  test('a target at the start of a section adds none of it', async () => {
    const book = makeBook(['a'.repeat(100), 'b'.repeat(100)]);
    const segs = await collectNewText(
      book,
      { sectionIndex: 0, charOffset: 0 },
      { sectionIndex: 1, sectionFraction: 0, bookFraction: 0.5 },
    );
    expect(segs.map((s) => s.sectionIndex)).toEqual([0]);
  });
});

describe('getSectionFraction', () => {
  test('maps the book fraction into the current section', () => {
    const book = makeBook(['a'.repeat(100), 'b'.repeat(300)]);
    expect(getSectionFraction(book, 1, 0.625)).toBeCloseTo(0.5);
    expect(getSectionFraction(book, 0, 0.9)).toBe(1);
  });
});

describe('batchSegments', () => {
  test('splits long sections and groups short ones under the limit', () => {
    const seg = (i: number, len: number) => ({
      sectionIndex: i,
      label: `C${i}`,
      start: 0,
      end: len,
      text: 'x'.repeat(len),
    });
    const batches = batchSegments([seg(0, 30), seg(1, 30), seg(2, 250)], 100);
    expect(batches.map((b) => b.map((s) => s.text.length))).toEqual([[30, 30], [100], [100], [50]]);
    expect(batches[3]![0]!.start).toBe(200);
  });
});

describe('parseCodexResponse', () => {
  test('reads JSON wrapped in prose or fences', () => {
    const raw =
      'Here:\n```json\n{"entries":[{"id":null,"name":"Bo","kind":"place","summary":"A town."}]}\n```';
    expect(parseCodexResponse(raw)).toEqual([
      { id: null, name: 'Bo', kind: 'place', aliases: [], summary: 'A town.' },
    ]);
  });

  test('rejects replies without the entries list', () => {
    expect(() => parseCodexResponse('{"foo":1}')).toThrow();
    expect(() => parseCodexResponse('no json')).toThrow();
  });
});

describe('mergeCodexUpdates', () => {
  test('updates by id or name, adds new entries with where they first appear', () => {
    const merged = mergeCodexUpdates(
      [entry({})],
      [
        {
          id: 'a1',
          name: 'Ann Smith',
          kind: 'character',
          aliases: ['Annie'],
          summary: 'Now older.',
        },
        { id: null, name: 'The Guild', kind: 'organization', aliases: [], summary: 'Traders.' },
      ],
      [
        { label: 'Chapter 3', text: 'Ann walked.' },
        { label: 'Chapter 4', text: 'the guild met' },
      ],
      0.4,
      1,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: 'a1',
      name: 'Ann',
      aliases: ['Annie', 'Ann Smith'],
      summary: 'Now older.',
      firstSeen: 'Chapter 1',
      updatedFraction: 0.4,
    });
    expect(merged[1]).toMatchObject({ name: 'The Guild', kind: 'group', firstSeen: 'Chapter 4' });
  });

  test('matches an update by alias', () => {
    const merged = mergeCodexUpdates(
      [entry({ aliases: ['Annie'] })],
      [{ id: null, name: 'annie', kind: 'character', aliases: [], summary: 'X' }],
      [{ label: 'C', text: '' }],
      0.1,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.summary).toBe('X');
  });
});

describe('buildCodexUserPrompt', () => {
  test('lists current notes and labels the new text', () => {
    const prompt = buildCodexUserPrompt(
      [entry({})],
      [{ sectionIndex: 0, label: 'Chapter 1', start: 0, end: 5, text: 'Hello' }],
    );
    expect(prompt).toContain('id=a1 | character | Ann: A girl.');
    expect(prompt).toContain('## Chapter 1\nHello');
  });
});

describe('updateCodex', () => {
  beforeEach(() => {
    mocks.saved.clear();
    mocks.generateText.mockReset();
  });

  test('sends only text up to the reading position and saves progress', async () => {
    const book = makeBook([
      'Ann lives here. '.repeat(10),
      'Bo is far. '.repeat(10),
      'SPOILER'.repeat(20),
    ]);
    mocks.generateText.mockResolvedValue({
      text: '{"entries":[{"id":null,"name":"Ann","kind":"character","summary":"Lives here."}]}',
    });
    const codex = await updateCodex({
      bookDoc: book,
      bookHash: 'h',
      bookTitle: 'T',
      authorName: '',
      settings: { ...DEFAULT_AI_SETTINGS, enabled: true },
      target: { sectionIndex: 2, sectionFraction: 0, bookFraction: 0.5 },
    });
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    const prompt = mocks.generateText.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('Bo is far.');
    expect(prompt).not.toContain('SPOILER');
    expect(codex.entries.map((e) => e.name)).toEqual(['Ann']);
    expect(codex.processedUpTo).toEqual({ sectionIndex: 2, charOffset: 0 });
    expect((mocks.saved.get('h') as BookCodex).coveredFraction).toBe(0.5);

    // Nothing new read: no request.
    await updateCodex({
      bookDoc: book,
      bookHash: 'h',
      bookTitle: 'T',
      authorName: '',
      settings: { ...DEFAULT_AI_SETTINGS, enabled: true },
      target: { sectionIndex: 2, sectionFraction: 0, bookFraction: 0.5 },
    });
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  test('skips when less than minChars is new', async () => {
    const book = makeBook(['short', 'next']);
    await updateCodex({
      bookDoc: book,
      bookHash: 'h2',
      bookTitle: 'T',
      authorName: '',
      settings: { ...DEFAULT_AI_SETTINGS, enabled: true },
      target: { sectionIndex: 1, sectionFraction: 0, bookFraction: 0.5 },
      minChars: 1000,
    });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
