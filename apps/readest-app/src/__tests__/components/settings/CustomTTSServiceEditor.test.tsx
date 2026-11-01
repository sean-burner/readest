import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

const store = vi.hoisted(() => ({
  updateService: vi.fn(),
  addService: vi.fn(),
  saveCustomTTSServices: vi.fn(),
}));
vi.mock('@/store/customTTSStore', () => ({
  useCustomTTSStore: { getState: () => store },
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));

import CustomTTSServiceEditor from '@/components/settings/CustomTTSServiceEditor';
import type { CustomTTSService } from '@/types/customTTS';

const service: CustomTTSService = {
  id: 's1',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-old',
  model: 'tts-1',
  addedAt: 1,
  updatedAt: 1,
};

afterEach(cleanup);

describe('CustomTTSServiceEditor', () => {
  it('saves a cleared API key as empty, so other devices drop it too', () => {
    render(<CustomTTSServiceEditor service={service} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    expect(store.updateService).toHaveBeenCalledWith('s1', expect.objectContaining({ apiKey: '' }));
  });

  it('saves MP3 and cleared voices explicitly, so other devices change too', () => {
    render(
      <CustomTTSServiceEditor
        service={{ ...service, responseFormat: 'wav', voices: 'Kore' }}
        onBack={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'mp3' } });
    fireEvent.change(screen.getByLabelText('Voices'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    expect(store.updateService).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ responseFormat: 'mp3', voices: '' }),
    );
  });

  it('offers no format for MiMo, which always answers in MP3', () => {
    const mimo = { ...service, baseUrl: 'https://api.xiaomimimo.com', model: 'mimo-v2.5-tts' };
    render(<CustomTTSServiceEditor service={mimo} onBack={vi.fn()} />);
    expect(screen.queryByLabelText('Format')).toBeNull();
  });

  it('switches to an ElevenLabs model and hides OpenAI-only fields for ElevenLabs', () => {
    render(<CustomTTSServiceEditor service={service} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.elevenlabs.io' },
    });
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe(
      'eleven_multilingual_v2',
    );
    expect(screen.queryByLabelText('Format')).toBeNull();
    expect(screen.queryByLabelText('Instructions')).toBeNull();
  });

  it('says the key failed when ElevenLabs lists no voices', async () => {
    fetchMock.mockImplementation(async () => new Response('Unauthorized', { status: 401 }));
    const el = {
      ...service,
      baseUrl: 'https://api.elevenlabs.io',
      model: 'eleven_multilingual_v2',
    };
    render(<CustomTTSServiceEditor service={el} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Test'));
    expect(await screen.findByText(/No voices found/)).toBeTruthy();
  });

  it('names the URL it tried when the test fails', async () => {
    fetchMock.mockImplementation(async () => new Response('Not found', { status: 404 }));
    render(<CustomTTSServiceEditor service={service} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Test'));
    expect((await screen.findByText(/HTTP 404/)).textContent).toContain(
      'https://api.openai.com/v1/audio/speech',
    );
  });

  it('names the MiMo chat completions URL when its test fails', async () => {
    fetchMock.mockImplementation(async () => new Response('Not found', { status: 404 }));
    const mimo = { ...service, baseUrl: 'https://api.xiaomimimo.com', model: 'mimo-v2.5-tts' };
    render(<CustomTTSServiceEditor service={mimo} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Test'));
    expect((await screen.findByText(/HTTP 404/)).textContent).toContain(
      'https://api.xiaomimimo.com/v1/chat/completions',
    );
  });
});
