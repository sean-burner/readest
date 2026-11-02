import type { AISettings } from './types';

// Kept free of the AI SDK so UI code can check this without loading the SDK.
// `ai` pulls in @ai-sdk/gateway and @vercel/oidc, which need Node's `os`.

/** Whether Claude is the configured, usable AI provider. */
export const isClaudeConfigured = (settings?: AISettings): settings is AISettings =>
  !!settings?.enabled && settings.provider === 'anthropic' && !!settings.anthropicApiKey;
