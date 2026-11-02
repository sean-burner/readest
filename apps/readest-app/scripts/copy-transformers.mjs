// Copies transformers.js and the ONNX runtime it loads into public/vendor so
// on-device embeddings (src/services/ai/localEmbedding.ts) load from the app
// itself rather than a CDN.
import { copyFileSync, mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const transformersDist = dirname(require.resolve('@huggingface/transformers'));
// onnxruntime-web is transformers.js's own dependency, next to it in the store.
const ortDist = join(realpathSync(join(transformersDist, '..')), '..', '..', 'onnxruntime-web', 'dist');
const out = join(import.meta.dirname, '..', 'public', 'vendor', 'transformers');

mkdirSync(out, { recursive: true });
copyFileSync(join(transformersDist, 'transformers.min.js'), join(out, 'transformers.min.js'));
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  copyFileSync(join(ortDist, f), join(out, f));
}
console.log(`Copied transformers.js and ONNX runtime to ${out}`);
