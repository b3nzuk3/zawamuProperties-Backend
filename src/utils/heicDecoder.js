import { Worker } from 'node:worker_threads'

export const HEIC_DECODE_TIMEOUT_MS = 15_000

// A fresh, terminable worker keeps synchronous WASM off the API event loop and
// releases the codec heap after every image. V8 limits do not cap external/WASM
// memory; decoded-pixel admission and host memory limits remain essential.
export async function decodeHeic(buffer, maxPixels, {
  timeoutMs = HEIC_DECODE_TIMEOUT_MS,
  workerUrl = new URL('./heicWorker.js', import.meta.url),
} = {}) {
  const worker = new Worker(workerUrl, {
    workerData: { buffer, maxPixels },
    resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
    // Do not inherit CLI/preload flags into the isolated codec.
    execArgv: [],
    stdout: true,
    stderr: true,
  })
  worker.stdout.resume()
  worker.stderr.resume()
  let timer
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Image conversion timed out')), timeoutMs)
      worker.once('error', () => reject(new Error('Image conversion failed')))
      worker.once('exit', () => reject(new Error('Image conversion stopped')))
      worker.once('message', result => {
        const { width, height, data } = result ?? {}
        if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
            width * height > maxPixels || !(data instanceof Uint8Array) || data.byteLength !== width * height * 4) {
          reject(new Error('Image conversion failed'))
          return
        }
        resolve({ width, height, buffer: Buffer.from(data.buffer, data.byteOffset, data.byteLength) })
      })
    })
  } finally {
    clearTimeout(timer)
    await worker.terminate()
  }
}
