import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import {
  OpenAICompatibleSpeechProvider,
  speechEndpoint,
} from '@/services/tts/providers/openaiCompatible';
import {
  SpeechSynthesisFatalError,
  SpeechSynthesisPermanentError,
} from '@/services/tts/providers/types';
import { MULTILINGUAL_LANG } from '@/services/tts/types';
import type { CustomTTSService } from '@/types/customTTS';

const service = (overrides: Partial<CustomTTSService> = {}): CustomTTSService => ({
  id: 'el',
  name: 'ElevenLabs',
  baseUrl: 'https://api.elevenlabs.io',
  apiKey: 'xi-test',
  model: 'eleven_multilingual_v2',
  addedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const req = (text = 'Hello, big world.') => ({
  lang: 'en-US',
  text,
  voice: 'el:21m00Tcm4TlvDq8ikWAM',
  pitch: 1,
});

// Character timings one tenth of a second apart, as ElevenLabs reports them.
const timed = (text: string, audio: number[] = [1, 2, 3]) => {
  const characters = [...text];
  return Response.json({
    audio_base64: btoa(String.fromCharCode(...audio)),
    alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => i / 10),
      character_end_times_seconds: characters.map((_, i) => (i + 1) / 10),
    },
  });
};

describe('ElevenLabs speech service', () => {
  let current: CustomTTSService;
  let provider: OpenAICompatibleSpeechProvider;

  beforeEach(() => {
    fetchMock.mockReset();
    current = service();
    provider = new OpenAICompatibleSpeechProvider(
      () => [current],
      async () => true,
    );
  });

  it('lists the account voices by id, named by their display name, for every language', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        voices: [
          { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
          { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
        ],
      }),
    );
    const voices = await provider.getAllVoices();
    expect(voices).toEqual([
      { id: 'el:21m00Tcm4TlvDq8ikWAM', name: 'Rachel', lang: MULTILINGUAL_LANG },
      { id: 'el:pNInz6obpgDQGcFmaJgB', name: 'Adam', lang: MULTILINGUAL_LANG },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.elevenlabs.io/v1/voices');
    expect(init.headers['xi-api-key']).toBe('xi-test');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('synthesizes with timestamps and turns character timings into word boundaries', async () => {
    fetchMock.mockResolvedValue(timed('Hello, big world.', [9, 8, 7]));
    const result = await provider.synthesize(req(), new AbortController().signal);

    expect([...new Uint8Array(result.audio)]).toEqual([9, 8, 7]);
    // 100ns ticks: character i starts at i/10 s = i * 1_000_000 ticks.
    expect(result.boundaries).toEqual([
      { text: 'Hello,', offset: 0, duration: 6_000_000 },
      { text: 'big', offset: 7_000_000, duration: 3_000_000 },
      { text: 'world.', offset: 11_000_000, duration: 6_000_000 },
    ]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/with-timestamps?output_format=mp3_44100_128',
    );
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe('xi-test');
    expect(JSON.parse(init.body)).toEqual({
      text: 'Hello, big world.',
      model_id: 'eleven_multilingual_v2',
    });
  });

  it('reaches the ElevenLabs API whatever path the base URL carries', () => {
    for (const baseUrl of [
      'https://api.elevenlabs.io/',
      'https://api.elevenlabs.io/v1',
      'https://api.eu.residency.elevenlabs.io',
    ]) {
      current.baseUrl = baseUrl;
      const host = new URL(baseUrl).origin;
      expect(speechEndpoint(current), baseUrl).toBe(`${host}/v1/text-to-speech`);
    }
  });

  it('returns audio without boundaries when the response has no alignment', async () => {
    fetchMock.mockResolvedValue(Response.json({ audio_base64: btoa('\x01\x02') }));
    const result = await provider.synthesize(req(), new AbortController().signal);
    expect([...new Uint8Array(result.audio)]).toEqual([1, 2]);
    expect(result.boundaries).toEqual([]);
  });

  it('stops the session on a bad key or used-up quota, and skips a rejected sentence', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"detail":{"status":"quota_exceeded"}}', { status: 401 }),
    );
    await expect(provider.synthesize(req(), new AbortController().signal)).rejects.toBeInstanceOf(
      SpeechSynthesisFatalError,
    );
    fetchMock.mockResolvedValueOnce(new Response('bad text', { status: 422 }));
    await expect(provider.synthesize(req(), new AbortController().signal)).rejects.toBeInstanceOf(
      SpeechSynthesisPermanentError,
    );
  });
});
