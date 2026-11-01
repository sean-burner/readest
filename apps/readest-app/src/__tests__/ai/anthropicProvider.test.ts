import { describe, test, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAnthropic: vi.fn(),
  model: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('@/services/ai/logger', () => ({
  aiLogger: { provider: { init: vi.fn(), error: vi.fn() } },
}));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => 'aiFetch' }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: mocks.createAnthropic }));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: mocks.generateText,
}));

import {
  AnthropicProvider,
  DEFAULT_ANTHROPIC_MODEL,
  isClaudeConfigured,
} from '@/services/ai/providers/AnthropicProvider';
import { getAIProvider } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';

const settings = (patch: Partial<AISettings> = {}): AISettings => ({
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  provider: 'anthropic',
  anthropicApiKey: 'sk-ant-test',
  ...patch,
});

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.model.mockImplementation((id: string) => ({ modelId: id }));
    mocks.createAnthropic.mockReturnValue(mocks.model);
  });

  test('requires an API key', () => {
    expect(() => new AnthropicProvider(settings({ anthropicApiKey: '' }))).toThrow();
    expect(() => getAIProvider(settings({ anthropicApiKey: '' }))).toThrow();
  });

  test('creates the client with the key, browser-access header and app fetch', () => {
    getAIProvider(settings());
    expect(mocks.createAnthropic).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test',
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      fetch: 'aiFetch',
    });
  });

  test('uses the chosen model, defaulting to the current Opus', () => {
    expect(new AnthropicProvider(settings()).getModel()).toEqual({
      modelId: DEFAULT_ANTHROPIC_MODEL,
    });
    expect(
      new AnthropicProvider(settings({ anthropicModel: 'claude-haiku-5-5' })).getModel(),
    ).toEqual({ modelId: 'claude-haiku-5-5' });
  });

  test('has no embedding model', () => {
    expect(() => new AnthropicProvider(settings()).getEmbeddingModel()).toThrow(/embedding/);
  });

  test('health check reports whether a request succeeds', async () => {
    const provider = new AnthropicProvider(settings());
    mocks.generateText.mockResolvedValueOnce({ text: 'hello' });
    expect(await provider.healthCheck()).toBe(true);
    mocks.generateText.mockRejectedValueOnce(new Error('401'));
    expect(await provider.healthCheck()).toBe(false);
  });

  test('isClaudeConfigured needs the assistant on, Claude selected and a key', () => {
    expect(isClaudeConfigured(settings())).toBe(true);
    expect(isClaudeConfigured(settings({ enabled: false }))).toBe(false);
    expect(isClaudeConfigured(settings({ provider: 'ollama' }))).toBe(false);
    expect(isClaudeConfigured(settings({ anthropicApiKey: '' }))).toBe(false);
    expect(isClaudeConfigured(undefined)).toBe(false);
  });
});
