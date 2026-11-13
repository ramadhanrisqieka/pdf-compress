export type ImageFormat = 'image/jpeg' | 'image/webp';

export interface ImageOptions {
  quality: number;      // 0.1 - 1
  maxSize: number;      // sisi terpanjang (px), 0 = jangan ubah ukuran
  format: ImageFormat;
}

export async function compressImage(file: File, opts: ImageOptions): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  if (opts.maxSize > 0 && Math.max(width, height) > opts.maxSize) {
    const ratio = opts.maxSize / Math.max(width, height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, opts.format, opts.quality),
  );
  if (!blob) throw new Error('Gagal membuat gambar hasil kompres');
  return blob;
}
