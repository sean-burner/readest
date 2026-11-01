import { describe, expect, it, vi, beforeEach } from 'vitest';

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock,
}));

import {
  buildAnimationDocument,
  extractAnimationScript,
  generateAnimationScript,
} from '@/services/ai/animation';

describe('extractAnimationScript', () => {
  it('takes the code block out of the reply', () => {
    expect(extractAnimationScript('Here it is:\n```js\nctx.fillRect(0,0,1,1);\n```\nEnjoy')).toBe(
      'ctx.fillRect(0,0,1,1);',
    );
  });

  it('accepts a bare script and rejects an empty one', () => {
    expect(extractAnimationScript('  draw();  ')).toBe('draw();');
    expect(() => extractAnimationScript('```js\n\n```')).toThrow();
  });
});

describe('buildAnimationDocument', () => {
  it('blocks network access and embeds the script after the canvas', () => {
    const doc = buildAnimationDocument('draw();');
    expect(doc).toContain(`content="default-src 'none'; script-src 'unsafe-inline'`);
    expect(doc.indexOf('<canvas id="stage"')).toBeLessThan(doc.indexOf('draw();'));
  });

  it('keeps the script from closing its own script element', () => {
    const doc = buildAnimationDocument('const s = "</script><img src=x>";');
    expect(doc).not.toContain('"</script><img');
    expect(doc).toContain('"<\\/script><img src=x>"');
  });
});

describe('generateAnimationScript', () => {
  beforeEach(() => generateTextMock.mockReset());

  it('sends the word, passage and discussion and returns the script', async () => {
    generateTextMock.mockResolvedValue({ text: '```js\nloop();\n```' });
    const script = await generateAnimationScript({
      model: 'claude' as never,
      word: 'bank',
      context: '<passage>along the [[bank]]</passage>',
      messages: [
        { role: 'user', content: 'Where does it come from?' },
        { role: 'assistant', content: 'From a word for bench.' },
      ],
    });
    expect(script).toBe('loop();');
    const args = generateTextMock.mock.calls[0]![0];
    expect(args.prompt).toContain('Word: bank');
    expect(args.prompt).toContain('along the [[bank]]');
    expect(args.prompt).toContain('Reader: Where does it come from?');
    expect(args.prompt).toContain('Claude: From a word for bench.');
  });
});
