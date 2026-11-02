import type { EmbeddingModel } from 'ai';

/**
 * Embeddings computed on the device with transformers.js, for providers that
 * have no embedding model of their own (Claude). Book indexing for Reedy and
 * the AI Assistant's book search then costs nothing and nothing leaves the
 * device.
 *
 * transformers.js and its ONNX runtime ship with the app under
 * public/vendor/transformers (copied by scripts/copy-transformers.mjs) and are
 * imported by URL on first use, so they stay out of the JS bundle and nothing
 * runs from a CDN. The model (about 25 MB) is downloaded from Hugging Face on
 * first use and cached by the browser where the Cache API is available.
 */

export const LOCAL_EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const LOCAL_EMBEDDING_DIM = 384;

const VENDOR_PATH = '/vendor/transformers/';
const ORT_FILE = 'ort-wasm-simd-threaded.asyncify';

const vendorUrl = (file: string) =>
  new URL(VENDOR_PATH + file, globalThis.location?.origin ?? 'http://localhost').href;

/** Texts per model call; small batches keep phone memory use low. */
const BATCH_SIZE = 8;

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

interface TransformersModule {
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    backends: { onnx: { wasm?: { wasmPaths?: unknown; numThreads?: number } } };
  };
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
      const transformers = await importModule(vendorUrl('transformers.min.js'));
      const { env } = transformers;
      env.allowLocalModels = false;
      env.useBrowserCache = typeof caches !== 'undefined';
      env.backends.onnx.wasm ??= {};
      env.backends.onnx.wasm.wasmPaths = {
        mjs: vendorUrl(`${ORT_FILE}.mjs`),
        wasm: vendorUrl(`${ORT_FILE}.wasm`),
      };
      // The app isn't cross-origin isolated, so ONNX can't use worker threads.
      env.backends.onnx.wasm.numThreads = 1;
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
