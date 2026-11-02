import { describe, test, expect, vi, beforeEach } from 'vitest';
import { embedMany } from 'ai';
import {
  createLocalEmbeddingModel,
  embedLocally,
  loadLocalExtractor,
  resetLocalExtractor,
} from '@/services/ai/localEmbedding';

const fakeExtractor = vi.fn(async (texts: string[], _options?: object) => ({
  tolist: () => texts.map((t) => [t.length, 1]),
}));

describe('local embeddings', () => {
  beforeEach(() => {
    resetLocalExtractor();
    fakeExtractor.mockClear();
  });

  test('embeds in small batches with mean pooling', async () => {
    const values = Array.from({ length: 10 }, (_, i) => 'x'.repeat(i + 1));
    const out = await embedLocally(values, undefined, async () => fakeExtractor);
    expect(out).toHaveLength(10);
    expect(out[9]).toEqual([10, 1]);
    expect(fakeExtractor).toHaveBeenCalledTimes(2);
    expect(fakeExtractor.mock.calls[0]![1]).toEqual({ pooling: 'mean', normalize: true });
  });

  test('stops when aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(embedLocally(['a'], ctrl.signal, async () => fakeExtractor)).rejects.toThrow();
  });

  test('loads the library once and retries after a failure', async () => {
    const pipeline = vi.fn(async () => fakeExtractor);
    const env = {
      allowLocalModels: true,
      useBrowserCache: false,
      backends: { onnx: {} as { wasm?: { wasmPaths?: unknown; numThreads?: number } } },
    };
    const importModule = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ env, pipeline });
    await expect(loadLocalExtractor(importModule)).rejects.toThrow('offline');
    await loadLocalExtractor(importModule);
    await loadLocalExtractor(importModule);
    expect(importModule).toHaveBeenCalledTimes(2);
    expect(pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'q8',
    });
    expect(env.allowLocalModels).toBe(false);
    expect(importModule.mock.calls[0]![0]).toMatch(
      /\/vendor\/transformers\/transformers\.min\.js$/,
    );
    expect(env.backends.onnx.wasm).toMatchObject({
      numThreads: 1,
      wasmPaths: { wasm: expect.stringMatching(/asyncify\.wasm$/) },
    });
  });

  test('works as an AI SDK embedding model', async () => {
    await loadLocalExtractor(async () => ({
      env: { allowLocalModels: true, useBrowserCache: false, backends: { onnx: {} } },
      pipeline: async () => fakeExtractor,
    }));
    const { embeddings } = await embedMany({
      model: createLocalEmbeddingModel(),
      values: ['ab', 'abc'],
    });
    expect(embeddings).toEqual([
      [2, 1],
      [3, 1],
    ]);
  });
});
