import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type { AIProvider, AISettings, AIProviderName } from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** Models offered in settings; any other model id can be typed in. */
export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

/** Whether Claude is the configured, usable AI provider. */
export const isClaudeConfigured = (settings?: AISettings): settings is AISettings =>
  !!settings?.enabled && settings.provider === 'anthropic' && !!settings.anthropicApiKey;

/**
 * Claude through the Anthropic Messages API, with the user's own API key.
 *
 * Requests go through {@link getAIFetch} so the Tauri app uses the Rust HTTP
 * transport. The web build calls the API straight from the browser, which
 * Anthropic only allows with the direct-browser-access header.
 *
 * Anthropic has no embedding models, so book indexing (RAG) is unavailable
 * with this provider; chat and the context dictionary work without it.
 */
export class AnthropicProvider implements AIProvider {
  id: AIProviderName = 'anthropic';
  name = 'Claude (Anthropic)';
  requiresAuth = true;

  private settings: AISettings;
  private client: ReturnType<typeof createAnthropic>;

  constructor(settings: AISettings) {
    if (!settings.anthropicApiKey) {
      throw new Error('Anthropic API key required');
    }
    this.settings = settings;
    this.client = createAnthropic({
      apiKey: settings.anthropicApiKey,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      fetch: getAIFetch(),
    });
    aiLogger.provider.init('anthropic', this.modelId);
  }

  private get modelId() {
    return this.settings.anthropicModel || DEFAULT_ANTHROPIC_MODEL;
  }

  getModel(): LanguageModel {
    return this.client(this.modelId);
  }

  getEmbeddingModel(): EmbeddingModel {
    throw new Error(
      'Claude has no embedding model. Book indexing needs Ollama or an OpenAI-compatible provider.',
    );
  }

  async isAvailable(): Promise<boolean> {
    return !!this.settings.anthropicApiKey;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await generateText({
        model: this.getModel(),
        prompt: 'hi',
        maxOutputTokens: 16,
        providerOptions: { anthropic: { effort: 'low' } },
        abortSignal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      return true;
    } catch (e) {
      aiLogger.provider.error('anthropic', `healthCheck failed: ${(e as Error).message}`);
      return false;
    }
  }
}
