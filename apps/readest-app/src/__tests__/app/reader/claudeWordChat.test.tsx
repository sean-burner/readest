import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ streamText: vi.fn(), generateText: vi.fn() }));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: Record<string, string>) =>
    o ? s.replace(/\{\{(\w+)\}\}/g, (_m, k) => o[k] ?? '') : s,
}));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => 'claude-model' }),
}));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText: mocks.streamText,
  generateText: mocks.generateText,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { saveFile: vi.fn() } }) }));

import ClaudeWordChat, {
  buildWordChatSystemPrompt,
} from '@/app/reader/components/annotator/ClaudeWordChat';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { SystemSettings } from '@/types/settings';

const selection = {
  before: 'We walked along the',
  after: 'until dusk.',
  bookTitle: 'River',
  bookAuthor: 'Ann',
};

const setClaude = (enabled: boolean) =>
  useSettingsStore.setState({
    settings: {
      aiSettings: {
        ...DEFAULT_AI_SETTINGS,
        enabled,
        provider: 'anthropic',
        anthropicApiKey: 'sk-ant-test',
      },
    } as SystemSettings,
  });

async function* chunks(...parts: string[]) {
  for (const p of parts) yield p;
}

describe('ClaudeWordChat', () => {
  beforeEach(() => mocks.streamText.mockReset());
  afterEach(cleanup);

  it('renders nothing unless Claude is configured', () => {
    setClaude(false);
    const { container } = render(<ClaudeWordChat word='bank' selection={selection} />);
    expect(container.childElementCount).toBe(0);
  });

  it('streams a reply grounded in the passage', async () => {
    setClaude(true);
    mocks.streamText.mockReturnValue({ textStream: chunks('A river', ' bank.') });
    render(<ClaudeWordChat word='bank' lang='en' selection={selection} />);

    fireEvent.click(screen.getByText('Discuss with Claude'));
    fireEvent.change(screen.getByLabelText('Message Claude'), {
      target: { value: 'Which sense is this?' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText('A river bank.')).toBeTruthy());
    const args = mocks.streamText.mock.calls[0]![0];
    expect(args.model).toBe('claude-model');
    expect(args.messages).toEqual([{ role: 'user', content: 'Which sense is this?' }]);
    expect(args.system).toContain('We walked along the [[bank]] until dusk.');
    expect(args.system).toContain('"River" by Ann');
  });

  it('shows the error and drops the empty reply when Claude fails', async () => {
    setClaude(true);
    mocks.streamText.mockReturnValue({
      // biome-ignore lint/correctness/useYield: a stream that fails before its first chunk
      textStream: (async function* () {
        throw new Error('Invalid API key');
      })(),
    });
    render(<ClaudeWordChat word='bank' selection={selection} />);
    fireEvent.click(screen.getByText('Discuss with Claude'));
    fireEvent.change(screen.getByLabelText('Message Claude'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText('Invalid API key')).toBeTruthy());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('ClaudeWordChat animation', () => {
  afterEach(cleanup);

  it('plays the animation Claude writes in a sandboxed frame', async () => {
    setClaude(true);
    mocks.generateText.mockResolvedValue({ text: '```js\nloop();\n```' });
    render(<ClaudeWordChat word='bank' selection={selection} />);
    fireEvent.click(screen.getByText('Discuss with Claude'));
    fireEvent.click(screen.getByText('Animate'));

    const frame = (await screen.findByTitle('Animation of "bank"')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('loop();');
    expect(mocks.generateText.mock.calls[0]![0].prompt).toContain('We walked along the [[bank]]');
  });
});

describe('buildWordChatSystemPrompt', () => {
  it('falls back gracefully without a selection', () => {
    const prompt = buildWordChatSystemPrompt('bank');
    expect(prompt).toContain('reading a book');
    expect(prompt).toContain('[[bank]]');
  });
});
