import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import { PiArrowsClockwise, PiCaretDown, PiStop } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookCodexStore } from '@/store/bookCodexStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveSysSettings } from '@/helpers/settings';
import { CODEX_KINDS, type CodexEntry, type CodexKind } from '@/services/ai/codex/types';

/** Notes changed this far past the reading position are hidden as possible spoilers. */
const AHEAD_TOLERANCE = 0.002;

interface BookNotesProps {
  bookKey: string;
}

/**
 * Running notes on the book's characters, places and concepts that the AI
 * builds from what has been read so far.
 */
const BookNotes: React.FC<BookNotesProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const aiSettings = settings?.aiSettings;
  const bookHash = bookKey.split('-')[0]!;
  const bookData = useBookDataStore((s) => s.getBookData(bookKey));
  const progress = useBookProgress(bookKey);
  const codex = useBookCodexStore((s) => s.codices[bookHash]);
  const run = useBookCodexStore((s) => s.runs[bookHash]);
  const { load, startUpdate, stopUpdate, clear } = useBookCodexStore();

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CodexKind | 'all'>('all');
  const [showAhead, setShowAhead] = useState(false);

  useEffect(() => {
    void load(bookHash);
  }, [bookHash, load]);

  const readFraction = progress?.fraction ?? 0;
  const autoUpdate = aiSettings?.codexAutoUpdate ?? true;

  const kindLabels: Record<CodexKind, string> = {
    character: _('Characters'),
    place: _('Places'),
    concept: _('Concepts'),
    group: _('Groups'),
    object: _('Objects'),
    event: _('Events'),
  };

  const { visible, aheadCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    let ahead = 0;
    const list = (codex?.entries ?? []).filter((e) => {
      if (e.updatedFraction > readFraction + AHEAD_TOLERANCE) {
        ahead++;
        if (!showAhead) return false;
      }
      if (kind !== 'all' && e.kind !== kind) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)) ||
        e.summary.toLowerCase().includes(q)
      );
    });
    return { visible: list, aheadCount: ahead };
  }, [codex, query, kind, readFraction, showAhead]);

  const grouped = useMemo(() => {
    const groups = new Map<CodexKind, CodexEntry[]>();
    for (const k of CODEX_KINDS) groups.set(k, []);
    for (const e of visible) groups.get(e.kind)?.push(e);
    for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return [...groups.entries()].filter(([, list]) => list.length > 0);
  }, [visible]);

  const presentKinds = useMemo(
    () => CODEX_KINDS.filter((k) => codex?.entries.some((e) => e.kind === k)),
    [codex],
  );

  if (!bookData?.bookDoc || !aiSettings) return null;

  const handleUpdate = () => {
    if (!progress || !bookData.bookDoc) return;
    void startUpdate({
      bookHash,
      bookDoc: bookData.bookDoc,
      bookTitle: bookData.book?.title || '',
      authorName: bookData.book?.author || '',
      settings: aiSettings,
      progress,
      upTo: 'page',
    });
  };

  const handleToggleAuto = () => {
    saveSysSettings(envConfig, 'aiSettings', { ...aiSettings, codexAutoUpdate: !autoUpdate });
  };

  const handleClear = () => {
    if (window.confirm(_('Delete all Book Notes for this book?'))) void clear(bookHash);
  };

  const covered = Math.round((codex?.coveredFraction ?? 0) * 100);
  const reading = Math.round(readFraction * 100);
  const behind = (codex?.coveredFraction ?? 0) + 0.01 < readFraction;
  const isEmpty = !codex?.entries.length;

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2 px-3 pb-2'>
      <div className='flex shrink-0 items-center gap-2 text-xs'>
        <span className='text-base-content/70 min-w-0 flex-1 truncate'>
          {run?.running
            ? run.progress && run.progress.totalBatches > 1
              ? _('Reading part {{n}} of {{total}}…', {
                  n: run.progress.batch,
                  total: run.progress.totalBatches,
                })
              : _('Reading…')
            : isEmpty
              ? _('No notes yet')
              : _('Notes cover {{covered}}% · you are at {{reading}}%', { covered, reading })}
        </span>
        {run?.running ? (
          <button
            type='button'
            className='btn btn-ghost btn-xs gap-1'
            onClick={() => stopUpdate(bookHash)}
          >
            <PiStop size={14} />
            {_('Stop')}
          </button>
        ) : (
          <button
            type='button'
            className='btn btn-ghost btn-xs gap-1'
            onClick={handleUpdate}
            disabled={!behind}
            title={_('Add what you have read up to this page')}
          >
            <PiArrowsClockwise size={14} />
            {isEmpty && reading > 5 ? _('Catch up') : _('Update')}
          </button>
        )}
      </div>

      {run?.error && (
        <p className='text-error shrink-0 text-xs' role='alert'>
          {run.error}
        </p>
      )}

      {isEmpty && !run?.running ? (
        <div className='text-base-content/70 flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm'>
          <p>
            {_(
              'Book Notes keep track of the characters, places and ideas in this book as you read. They only use what you have read so far.',
            )}
          </p>
          {reading > 5 && (
            <p className='text-xs'>
              {_(
                'Tap Catch up to build notes for everything up to this page. Long books take several requests.',
              )}
            </p>
          )}
        </div>
      ) : (
        <>
          <input
            type='search'
            className='input input-sm input-bordered bg-base-100 w-full shrink-0'
            placeholder={_('Search notes')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={_('Search notes')}
          />
          {presentKinds.length > 1 && (
            <div className='flex shrink-0 flex-wrap gap-1' role='tablist'>
              {(['all', ...presentKinds] as const).map((k) => (
                <button
                  key={k}
                  type='button'
                  role='tab'
                  aria-selected={kind === k}
                  className={clsx(
                    'btn btn-xs rounded-full',
                    kind === k ? 'btn-neutral' : 'btn-ghost',
                  )}
                  onClick={() => setKind(k)}
                >
                  {k === 'all' ? _('All') : kindLabels[k]}
                </button>
              ))}
            </div>
          )}
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {grouped.map(([k, list]) => (
              <section key={k} className='mb-3'>
                <h3 className='text-base-content/60 mb-1 text-xs font-semibold uppercase'>
                  {kindLabels[k]}
                </h3>
                <ul>
                  {list.map((entry) => (
                    <li key={entry.id} className='mb-1.5'>
                      <details className='eink-bordered border-base-300 bg-base-100 group rounded-lg border'>
                        <summary className='flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium'>
                          <span className='min-w-0 flex-1 truncate'>{entry.name}</span>
                          <PiCaretDown
                            size={14}
                            className='shrink-0 transition-transform group-open:rotate-180'
                          />
                        </summary>
                        <div className='select-text px-3 pb-2 text-sm'>
                          {entry.aliases.length > 0 && (
                            <p className='text-base-content/60 mb-1 text-xs'>
                              {_('Also: {{names}}', { names: entry.aliases.join(', ') })}
                            </p>
                          )}
                          <p className='whitespace-pre-wrap'>{entry.summary}</p>
                          {entry.firstSeen && (
                            <p className='text-base-content/50 mt-1 text-xs'>
                              {_('First seen: {{label}}', { label: entry.firstSeen })}
                            </p>
                          )}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {aheadCount > 0 && (
              <button
                type='button'
                className='btn btn-ghost btn-xs w-full'
                onClick={() => setShowAhead(!showAhead)}
              >
                {showAhead
                  ? _('Hide notes from further ahead')
                  : _('{{count}} notes include parts past this page (show)', {
                      count: aheadCount,
                    })}
              </button>
            )}
          </div>
        </>
      )}

      <div className='border-base-300/50 flex shrink-0 items-center gap-2 border-t pt-2 text-xs'>
        <label className='flex flex-1 cursor-pointer items-center gap-2'>
          <input
            type='checkbox'
            className='toggle toggle-xs'
            checked={autoUpdate}
            onChange={handleToggleAuto}
          />
          {_('Update after each chapter')}
        </label>
        {!isEmpty && (
          <button type='button' className='btn btn-ghost btn-xs' onClick={handleClear}>
            {_('Clear')}
          </button>
        )}
      </div>
    </div>
  );
};

export default BookNotes;
