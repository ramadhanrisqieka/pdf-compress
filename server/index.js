import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compressPdfFile } from './engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isProd = process.argv.includes('--prod');
const PORT = Number(process.env.PORT) || 3000;
const MAX_BYTES = 1.5 * 1024 * 1024 * 1024; // batas aman Buffer Node.js

const tmpDir = path.join(os.tmpdir(), 'pdf-compress');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: MAX_BYTES } });

/** @type {Map<string, any>} */
const jobs = new Map();
const rm = (p) => p && fs.promises.rm(p, { force: true }).catch(() => {});

// Bersihkan job & file sementara yang sudah lebih dari 30 menit
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAt > 30 * 60 * 1000 && j.status !== 'working') {
      rm(j.inPath); rm(j.outPath); jobs.delete(id);
    }
  }
}, 60 * 1000).unref();

const app = express();

app.post('/api/compress', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
  const mode = req.body.mode === 'preset' ? 'preset' : 'target';
  const targetMB = Number(req.body.targetMB);
  if (mode === 'target' && !(targetMB > 0)) {
    rm(req.file.path);
    return res.status(400).json({ error: 'Target ukuran (MB) tidak valid.' });
  }

  const id = crypto.randomUUID();
  const base = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const job = {
    id, status: 'working', pct: 0, message: 'Memulai…', createdAt: Date.now(),
    inPath: req.file.path, outPath: req.file.path + '.out.pdf',
    outName: `${base}-compressed.pdf`,
  };
  jobs.set(id, job);
  res.json({ id });

  compressPdfFile(job.inPath, job.outPath, { mode, targetMB, preset: req.body.preset }, (p) => {
    job.pct = Math.min(99, Math.round(p.pct));
    job.message = p.message;
  })
    .then((r) => { job.status = 'done'; job.pct = 100; job.result = r; job.message = 'Selesai'; rm(job.inPath); })
    .catch((e) => { job.status = 'error'; job.error = e.message || String(e); rm(job.inPath); rm(job.outPath); });
});

app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Job tidak ditemukan (mungkin sudah kedaluwarsa).' });
  res.json({ status: j.status, pct: j.pct, message: j.message, error: j.error, result: j.result });
});

app.get('/api/jobs/:id/download', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done') return res.status(404).send('File tidak tersedia.');
  res.download(j.outPath, j.outName);
});

app.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File terlalu besar (maksimal 1,5 GB).' });
  next(err);
});

if (isProd) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const server = app.listen(PORT, () => {
  console.log(`PDF Compress berjalan di http://localhost:${PORT}  (${isProd ? 'production' : 'development'})`);
});
server.requestTimeout = 0; // upload file besar tidak boleh kena timeout
server.headersTimeout = 0;
