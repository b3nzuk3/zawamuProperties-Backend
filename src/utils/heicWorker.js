import { parentPort, workerData } from 'node:worker_threads'
import libheif from 'libheif-js/wasm-bundle.js'

// libheif applies HEIF item rotation/mirroring during display. Do not apply
// EXIF rotation again to the returned, already oriented RGBA pixels.
let decoder
let images = []
try {
  await libheif.ready
  decoder = new libheif.HeifDecoder()
  images = decoder.decode(workerData.buffer)
  if (images.length !== 1) throw new Error('Expected one image')
  const image = images[0]
  const width = image.get_width()
  const height = image.get_height()
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
      width * height > workerData.maxPixels) throw new Error('Invalid dimensions')
  // Inspect decoder dimensions before allocating the raw output, independently
  // of Sharp's earlier header check.
  const rgba = new Uint8ClampedArray(width * height * 4)
  const displayed = await new Promise(resolve => image.display({ data: rgba, width, height }, resolve))
  if (!displayed || displayed.width !== width || displayed.height !== height) throw new Error('Decode failed')
  const data = new Uint8Array(rgba.buffer)
  parentPort.postMessage({ width, height, data }, [data.buffer])
} catch {
  // Never return codec diagnostics or untrusted metadata to API logs/clients.
  parentPort.postMessage({ failed: true })
} finally {
  for (const image of images) image.free()
  decoder?.decoder?.delete()
}
