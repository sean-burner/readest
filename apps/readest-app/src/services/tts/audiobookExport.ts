// Export a book's Read Aloud audio as an audiobook: one tagged MP3 per
// chapter, named in reading order. The audio is the per-sentence cache that
// chapter downloads fill, so exporting synthesizes nothing new once every
// chapter is downloaded. MP3 frames concatenate cleanly, so each chapter is
// its sentences back to back with their own tags removed, under one ID3 tag.

import type { DownloadChapter } from './downloadChapters';

export interface AudiobookMeta {
  title: string;
  author: string;
}

export interface AudiobookSource {
  // A section's sentences in reading order, or null when it can't be read.
  sentencesOf(section: number): Promise<{ lang: string; text: string }[] | null>;
  // One sentence's compressed audio.
  audioOf(sentence: { lang: string; text: string }, signal: AbortSignal): Promise<ArrayBuffer>;
}

export interface AudiobookExportProgress {
  chapter: number;
  total: number;
}

const isMp3 = (bytes: Uint8Array) =>
  (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || // "ID3"
  (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0); // frame sync

// The audio frames of one MP3, without a leading ID3v2 or trailing ID3v1 tag.
const mp3Frames = (audio: ArrayBuffer): Uint8Array => {
  let bytes = new Uint8Array(audio);
  if (!isMp3(bytes)) throw new Error('Audiobook export needs MP3 audio from the voice');
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.length >= 10) {
    // Syncsafe size: 7 bits per byte, plus the 10-byte header (and footer).
    const size = ((bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!) >>> 0;
    const footer = bytes[5]! & 0x10 ? 10 : 0;
    bytes = bytes.subarray(10 + size + footer);
  }
  const tail = bytes.length - 128;
  if (tail >= 0 && bytes[tail] === 0x54 && bytes[tail + 1] === 0x41 && bytes[tail + 2] === 0x47) {
    bytes = bytes.subarray(0, tail); // "TAG"
  }
  return bytes;
};

export const concatMp3 = (segments: ArrayBuffer[]): Uint8Array => {
  const frames = segments.map(mp3Frames);
  const out = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
};

// An ID3v2.3 text frame in UTF-16 with BOM, which every player reads.
const textFrame = (id: string, value: string): Uint8Array => {
  const body = new Uint8Array(3 + value.length * 2);
  body.set([0x01, 0xff, 0xfe]);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    body[3 + i * 2] = code & 0xff;
    body[4 + i * 2] = code >> 8;
  }
  const frame = new Uint8Array(10 + body.length);
  frame.set([...id].map((c) => c.charCodeAt(0)));
  new DataView(frame.buffer).setUint32(4, body.length);
  frame.set(body, 10);
  return frame;
};

export const id3Tag = (tags: {
  title: string;
  album: string;
  artist: string;
  track: number;
  total: number;
}): Uint8Array => {
  const frames = [
    textFrame('TIT2', tags.title),
    textFrame('TALB', tags.album),
    ...(tags.artist ? [textFrame('TPE1', tags.artist)] : []),
    textFrame('TRCK', `${tags.track}/${tags.total}`),
    textFrame('TCON', 'Audiobook'),
  ];
  const size = frames.reduce((n, f) => n + f.length, 0);
  const tag = new Uint8Array(10 + size);
  tag.set([0x49, 0x44, 0x33, 3, 0, 0]);
  tag.set([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f], 6);
  let at = 10;
  for (const f of frames) {
    tag.set(f, at);
    at += f.length;
  }
  return tag;
};

// A name any file system accepts: no reserved characters, no trailing dot.
export const safeFileName = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);

// "03 - The Storm.mp3": numbered so any player lists chapters in order, and
// without characters a file system refuses.
export const chapterFileName = (index: number, total: number, label: string): string => {
  const number = String(index + 1).padStart(Math.max(2, String(total).length), '0');
  const name = safeFileName(label);
  return `${number}${name ? ` - ${name}` : ''}.mp3`;
};

// Builds each chapter's MP3 in reading order and hands it to `write`, one at a
// time, so only one chapter's audio is in memory at once.
export const exportAudiobook = async (
  chapters: DownloadChapter[],
  source: AudiobookSource,
  meta: AudiobookMeta,
  write: (fileName: string, data: Uint8Array) => Promise<void>,
  onProgress?: (progress: AudiobookExportProgress) => void,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> => {
  for (const [index, chapter] of chapters.entries()) {
    onProgress?.({ chapter: index, total: chapters.length });
    const segments: ArrayBuffer[] = [];
    for (let section = chapter.startSection; section < chapter.endSection; section++) {
      for (const sentence of (await source.sentencesOf(section)) ?? []) {
        if (signal.aborted) return;
        segments.push(await source.audioOf(sentence, signal));
      }
    }
    if (!segments.length) continue;
    const tag = id3Tag({
      title: chapter.label,
      album: meta.title,
      artist: meta.author,
      track: index + 1,
      total: chapters.length,
    });
    const audio = concatMp3(segments);
    const file = new Uint8Array(tag.length + audio.length);
    file.set(tag);
    file.set(audio, tag.length);
    await write(chapterFileName(index, chapters.length, chapter.label), file);
  }
  onProgress?.({ chapter: chapters.length, total: chapters.length });
};
