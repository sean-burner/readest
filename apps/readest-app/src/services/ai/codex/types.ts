export const CODEX_KINDS = ['character', 'place', 'concept', 'group', 'object', 'event'] as const;
export type CodexKind = (typeof CODEX_KINDS)[number];

/** One running note Claude keeps about a character, place, concept, etc. */
export interface CodexEntry {
  id: string;
  name: string;
  kind: CodexKind;
  aliases: string[];
  /** What the reader knows about this entry so far, rewritten as the story moves. */
  summary: string;
  /** Short label (chapter title) where the entry first appeared. */
  firstSeen: string;
  /** Reading position (0..1) when the entry was last changed. */
  updatedAt: number;
  updatedFraction: number;
}

/** Where in the book the notes have been built up to. */
export interface CodexPosition {
  sectionIndex: number;
  /** Characters of the section's text already read into the notes. */
  charOffset: number;
}

export interface BookCodex {
  bookHash: string;
  entries: CodexEntry[];
  processedUpTo: CodexPosition;
  /** Overall reading fraction (0..1) the notes cover. */
  coveredFraction: number;
  updatedAt: number;
}

export const emptyCodex = (bookHash: string): BookCodex => ({
  bookHash,
  entries: [],
  processedUpTo: { sectionIndex: 0, charOffset: 0 },
  coveredFraction: 0,
  updatedAt: 0,
});
