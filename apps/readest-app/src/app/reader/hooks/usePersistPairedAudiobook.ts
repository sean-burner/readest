import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { PairedAudiobook } from '@/types/book';

// Saves (or clears) a book's paired audiobook in its config. Pairing turns
// narration on, so Read Aloud plays the audiobook instead of synthesizing.
export const usePersistPairedAudiobook = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const getConfig = useBookDataStore((state) => state.getConfig);
  const setConfig = useBookDataStore((state) => state.setConfig);
  const saveConfig = useBookDataStore((state) => state.saveConfig);

  return async (nextAssociation: PairedAudiobook | undefined) => {
    const current = getConfig(bookKey);
    if (!current) throw new Error(_('Book configuration is unavailable'));
    const viewSettings = {
      ...current.viewSettings,
      ...(nextAssociation ? { ttsUseNarration: true } : {}),
    };
    const updatedConfig = {
      ...current,
      audiobook: nextAssociation,
      viewSettings,
      updatedAt: Date.now(),
    };
    await saveConfig(envConfig, bookKey, updatedConfig, settings);
    setConfig(bookKey, { audiobook: nextAssociation, viewSettings });
    const liveViewSettings = useReaderStore.getState().getViewSettings(bookKey);
    if (liveViewSettings && nextAssociation) {
      useReaderStore
        .getState()
        .setViewSettings(bookKey, { ...liveViewSettings, ttsUseNarration: true });
    }
  };
};
