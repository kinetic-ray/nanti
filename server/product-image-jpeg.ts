import sharp from 'sharp';
import { boundedJpeg } from './tokopedia-metadata.js';

export async function compressProductImage(bytes: Buffer, allowRasterFormats = false): Promise<Buffer | null> {
  if (!bytes.length || bytes.length > 195_000) return null;
  const jpeg = boundedJpeg(bytes);
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const format = jpeg ? 'jpeg' : png ? 'png' : webp ? 'webp' : null;
  if (!format || (!allowRasterFormats && format !== 'jpeg')) return null;
  try {
    const image = sharp(bytes, { limitInputPixels: 1600 * 1600, failOn: 'warning' }).autoOrient();
    const metadata = await image.metadata();
    if (metadata.format !== format || metadata.width > 1600 || metadata.height > 1600 || (metadata.pages ?? 1) > 1) return null;
    const firstSize = Math.min(1200, Math.max(metadata.width, metadata.height));
    const attempts: [number, number][] = [[firstSize, 82], [firstSize, 72]];
    for (const size of [900, 650, 480]) if (size < firstSize) attempts.push([size, 82]);
    for (const [size, quality] of attempts) {
      const output = await image.clone().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (output.length <= 195_000) return output;
    }
  } catch {
    // A corrupt or unsupported image falls back to the text-only product.
  }
  return null;
}
