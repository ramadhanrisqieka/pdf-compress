// Mesin kompres PDF: hanya mengecilkan GAMBAR yang tertanam di dalam PDF.
// Teks, vektor, tabel, dan tata letak tidak disentuh, jadi hasilnya tetap tajam & bisa diseleksi.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import os from 'node:os';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFNumber, PDFArray, PDFRawStream, PDFDict } from 'pdf-lib';

sharp.cache(false);

const CONCURRENCY = Math.max(1, Math.min(4, os.availableParallelism?.() ?? 2));
// mozjpeg: ~25% lebih kecil tapi ~4x lebih lambat. Dipakai hanya jika total gambar tidak terlalu besar.
const MOZJPEG_LIMIT = 250 * 1024 * 1024;

// Tangga kualitas dari paling jernih (0) sampai paling kecil (11).
export const LADDER = [
  { maxSide: 3200, quality: 90 },
  { maxSide: 2800, quality: 87 },
  { maxSide: 2400, quality: 84 },
  { maxSide: 2100, quality: 81 },
  { maxSide: 1800, quality: 78 },
  { maxSide: 1600, quality: 75 },
  { maxSide: 1400, quality: 72 },
  { maxSide: 1200, quality: 68 },
  { maxSide: 1000, quality: 64 },
  { maxSide: 850, quality: 58 },
  { maxSide: 700, quality: 52 },
  { maxSide: 560, quality: 45 },
];

export const PRESET_LEVEL = { tinggi: 2, seimbang: 5, kecil: 8 };

const N = (s) => PDFName.of(s);

function num(ctx, v) {
  const r = ctx.lookup(v);
  return r instanceof PDFNumber ? r.asNumber() : undefined;
}

function filterNames(ctx, dict) {
  const f = ctx.lookup(dict.get(N('Filter')));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map((x) => String(ctx.lookup(x)).replace('/', ''));
  return [String(f).replace('/', '')];
}

function channelsOfColorSpace(ctx, dict) {
  const cs = ctx.lookup(dict.get(N('ColorSpace')));
  if (!cs) return undefined;
  const s = String(cs);
  if (s === '/DeviceRGB') return 3;
  if (s === '/DeviceGray') return 1;
  if (cs instanceof PDFArray) {
    const first = String(ctx.lookup(cs.get(0)));
    if (first === '/ICCBased') {
      const icc = ctx.lookup(cs.get(1));
      const n = icc && icc.dict ? num(ctx, icc.dict.get(N('N'))) : undefined;
      if (n === 1 || n === 3) return n;
    }
    if (first === '/CalRGB') return 3;
    if (first === '/CalGray') return 1;
  }
  return undefined; // Indexed, Separation, CMYK, dll: dilewati
}

// Membuka filter prediktor PNG (Flate + Predictor >= 10)
function unpredictPng(data, width, channels, height) {
  const bpp = channels;
  const rowLen = width * channels;
  const out = Buffer.alloc(rowLen * height);
  let prev = Buffer.alloc(rowLen);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const ft = data[p++];
    const row = out.subarray(y * rowLen, (y + 1) * rowLen);
    for (let x = 0; x < rowLen; x++) {
      const raw = data[p++];
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('filter PNG tidak dikenal');
      }
      row[x] = v & 255;
    }
    prev = row;
  }
  return out;
}

/** Daftar gambar yang layak dikompres beserta ukurannya. */
function collectImages(pdf) {
  const ctx = pdf.context;
  const list = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (String(ctx.lookup(dict.get(N('Subtype')))) !== '/Image') continue;
    if (dict.has(N('SMask')) || dict.has(N('Mask')) || dict.has(N('Decode'))) continue;
    if (String(ctx.lookup(dict.get(N('ImageMask')))) === 'true') continue;
    const filters = filterNames(ctx, dict);
    if (filters.length !== 1 || !['DCTDecode', 'FlateDecode'].includes(filters[0])) continue;
    const bpc = num(ctx, dict.get(N('BitsPerComponent')));
    if (bpc !== 8) continue;
    const channels = channelsOfColorSpace(ctx, dict);
    if (!channels) continue;
    const size = obj.getContentsSize();
    // Gambar kecil (logo, ikon) tidak perlu disentuh
    if (size < (filters[0] === 'FlateDecode' ? 200_000 : 40_000)) continue;
    list.push({ ref, obj, size, filter: filters[0], channels });
  }
  return list;
}

/** Kompres satu gambar. Mengembalikan {bytes, width, height} atau null bila tidak lebih kecil. */
async function recompress(ctx, item, level, moz) {
  const { obj, filter, channels } = item;
  const { maxSide, quality } = level;
  const raw = Buffer.from(obj.getContents());
  let input;
  let w;
  let h;

  if (filter === 'DCTDecode') {
    const meta = await sharp(raw, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height || meta.channels !== channels || meta.space === 'cmyk') return null;
    input = sharp(raw, { failOn: 'none' });
    w = meta.width;
    h = meta.height;
  } else {
    w = num(ctx, obj.dict.get(N('Width')));
    h = num(ctx, obj.dict.get(N('Height')));
    if (!w || !h) return null;
    let data = zlib.inflateSync(raw);
    const parms = ctx.lookup(obj.dict.get(N('DecodeParms')));
    const predictor = parms instanceof PDFDict ? num(ctx, parms.get(N('Predictor'))) || 1 : 1;
    if (predictor >= 10) data = unpredictPng(data, w, channels, h);
    else if (predictor !== 1) return null;
    if (data.length !== w * h * channels) return null;
    input = sharp(data, { raw: { width: w, height: h, channels } });
  }

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  if (scale < 1) input = input.resize(nw, nh, { kernel: 'lanczos3', fit: 'fill' });

  const out = await input
    .jpeg({ quality, mozjpeg: moz, chromaSubsampling: quality >= 85 ? '4:4:4' : '4:2:0' })
    .toBuffer();

  if (out.length >= item.size * 0.97) return null; // tidak lebih kecil: biarkan aslinya
  return { bytes: out, width: nw, height: nh };
}

function applyResult(pdf, item, res) {
  const ctx = pdf.context;
  const dict = item.obj.dict.clone(ctx);
  dict.set(N('Filter'), N('DCTDecode'));
  dict.delete(N('DecodeParms'));
  dict.set(N('Width'), PDFNumber.of(res.width));
  dict.set(N('Height'), PDFNumber.of(res.height));
  dict.set(N('BitsPerComponent'), PDFNumber.of(8));
  ctx.assign(item.ref, PDFRawStream.of(dict, res.bytes));
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/** Perkirakan ukuran akhir tiap level dengan mencoba sampel gambar saja. */
async function pickLevel(pdf, images, fileSize, targetBytes, moz, onProgress) {
  const ctx = pdf.context;
  const eligible = images.reduce((s, i) => s + i.size, 0);
  const rest = fileSize - eligible;

  const sorted = [...images].sort((a, b) => b.size - a.size);
  const step = Math.max(1, Math.floor(sorted.length / 10));
  const sample = sorted.filter((_, i) => i % step === 0).slice(0, 10);
  const sampleSize = sample.reduce((s, i) => s + i.size, 0);

  const predict = async (lv) => {
    let total = 0;
    await mapLimit(sample, CONCURRENCY, async (it) => {
      const r = await recompress(ctx, it, LADDER[lv], moz).catch(() => null);
      total += r ? r.bytes.length : it.size;
    });
    return rest + eligible * (total / sampleSize);
  };

  // Binary search: level terkecil (paling jernih) yang masih muat di target
  let lo = 0;
  let hi = LADDER.length - 1;
  let best = hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    onProgress?.({ pct: 5 + (1 - (hi - lo) / LADDER.length) * 10, message: 'Menghitung pengaturan terbaik…' });
    const est = await predict(mid);
    if (est <= targetBytes * 0.97) { best = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return best;
}

async function runLevel(bytes, levelIdx, moz, onProgress, basePct) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const images = collectImages(pdf);
  let done = 0;
  let changed = 0;
  await mapLimit(images, CONCURRENCY, async (it) => {
    try {
      const r = await recompress(pdf.context, it, LADDER[levelIdx], moz);
      if (r) { applyResult(pdf, it, r); changed++; }
    } catch { /* gambar bermasalah dilewati, tetap pakai aslinya */ }
    done++;
    onProgress?.({ pct: basePct + (done / Math.max(1, images.length)) * 70, message: `Mengompres gambar ${done}/${images.length}…` });
  });
  onProgress?.({ pct: basePct + 72, message: 'Menyimpan PDF…' });
  const out = await pdf.save({ useObjectStreams: true });
  return { out, imageCount: images.length, changed };
}

/**
 * @param {string} inPath
 * @param {string} outPath
 * @param {{mode:'target'|'preset', targetMB?:number, preset?:string}} opts
 */
export async function compressPdfFile(inPath, outPath, opts, onProgress) {
  onProgress?.({ pct: 1, message: 'Membaca PDF…' });
  const bytes = await fs.readFile(inPath);
  const inSize = bytes.length;

  let probe;
  try {
    probe = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    if (/encrypted/i.test(String(e))) throw new Error('PDF ini diproteksi password. Buka proteksinya dulu.');
    throw new Error('File PDF tidak bisa dibaca (rusak atau bukan PDF).');
  }
  const images = collectImages(probe);
  if (images.length === 0) {
    await fs.writeFile(outPath, bytes);
    return { inSize, outSize: inSize, imageCount: 0, changed: 0, level: null, reachedTarget: true,
      note: 'Tidak ada gambar besar yang bisa dikompres di PDF ini (mungkin berisi teks saja atau hasil scan khusus).' };
  }

  const moz = images.reduce((a, i) => a + i.size, 0) <= MOZJPEG_LIMIT;
  let levelIdx;
  let targetBytes = null;
  if (opts.mode === 'target') {
    targetBytes = Math.max(0.1, Number(opts.targetMB)) * 1024 * 1024;
    if (inSize <= targetBytes) {
      await fs.writeFile(outPath, bytes);
      return { inSize, outSize: inSize, imageCount: images.length, changed: 0, level: null, reachedTarget: true,
        note: 'Ukuran file sudah di bawah target, jadi tidak diubah.' };
    }
    levelIdx = await pickLevel(probe, images, inSize, targetBytes, moz, onProgress);
  } else {
    levelIdx = PRESET_LEVEL[opts.preset] ?? PRESET_LEVEL.seimbang;
  }

  let result;
  for (let attempt = 0; attempt < 4; attempt++) {
    result = await runLevel(bytes, levelIdx, moz, onProgress, 18);
    if (!targetBytes || result.out.length <= targetBytes || levelIdx >= LADDER.length - 1) break;
    onProgress?.({ pct: 20, message: 'Masih di atas target, menurunkan kualitas sedikit…' });
    levelIdx = Math.min(LADDER.length - 1, levelIdx + 1);
  }

  // Jangan pernah mengembalikan file yang lebih besar dari aslinya
  const finalBytes = result.out.length < inSize ? result.out : bytes;
  await fs.writeFile(outPath, finalBytes);
  const outSize = finalBytes.length;
  return {
    inSize, outSize,
    imageCount: result.imageCount, changed: result.changed,
    level: LADDER[levelIdx],
    reachedTarget: targetBytes ? outSize <= targetBytes : true,
    note: targetBytes && outSize > targetBytes
      ? 'Target belum tercapai karena sisa ukuran bukan dari gambar (font/teks/halaman). Ini ukuran terkecil yang aman.'
      : undefined,
  };
}
