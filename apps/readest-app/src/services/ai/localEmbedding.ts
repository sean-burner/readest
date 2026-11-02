import type { EmbeddingModel } from 'ai';

/**
 * Embeddings computed on the device with transformers.js, for providers that
 * have no embedding model of their own (Claude). Book indexing for Reedy and
 * the AI Assistant's book search then costs nothing and nothing leaves the
 * device.
 *
 * transformers.js is loaded from the CDN on first use rather than bundled: it
 * is large, ships its own ONNX runtime and is only needed once someone indexes
 * a book. The model (about 25 MB) is downloaded from Hugging Face on first use
 * and cached by the browser where the Cache API is available.
 */

export const LOCAL_EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const LOCAL_EMBEDDING_DIM = 384;

const TRANSFORMERS_URL =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

/** Texts per model call; small batches keep phone memory use low. */
const BATCH_SIZE = 8;

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

interface TransformersModule {
  env: { allowLocalModels: boolean; useBrowserCache: boolean };
  pipeline(task: 'feature-extraction', model: string, options?: object): Promise<Extractor>;
}

let extractorPromise: Promise<Extractor> | null = null;

/** Loads the library and model once; a failed load is retried next time. */
export const loadLocalExtractor = (
  importModule: (url: string) => Promise<TransformersModule> = (url) =>
    import(/* webpackIgnore: true */ /* @vite-ignore */ url),
): Promise<Extractor> => {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const transformers = await importModule(TRANSFORMERS_URL);
      transformers.env.allowLocalModels = false;
      transformers.env.useBrowserCache = typeof caches !== 'undefined';
      return transformers.pipeline('feature-extraction', LOCAL_EMBEDDING_MODEL_ID, {
        dtype: 'q8',
      });
    })().catch((error) => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
};

/** Test hook: forget the loaded model. */
export const resetLocalExtractor = () => {
  extractorPromise = null;
};

export const embedLocally = async (
  values: string[],
  abortSignal?: AbortSignal,
  load: () => Promise<Extractor> = loadLocalExtractor,
): Promise<number[][]> => {
  const extractor = await load();
  const out: number[][] = [];
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    abortSignal?.throwIfAborted();
    const batch = values.slice(i, i + BATCH_SIZE);
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    out.push(...tensor.tolist());
  }
  return out;
};

/** A Vercel AI SDK embedding model backed by {@link embedLocally}. */
export const createLocalEmbeddingModel = (): EmbeddingModel => ({
  specificationVersion: 'v3',
  provider: 'local',
  modelId: LOCAL_EMBEDDING_MODEL_ID,
  maxEmbeddingsPerCall: 64,
  supportsParallelCalls: false,
  async doEmbed({ values, abortSignal }) {
    const embeddings = await embedLocally(values, abortSignal);
    return { embeddings, warnings: [] };
  },
});
