import { useState, type ReactNode } from 'react';
import { Image as ImageIcon, FileText, Minimize2 } from 'lucide-react';
import Dropzone from './components/Dropzone';
import ResultList, { Item } from './components/ResultList';
import { compressImage, ImageFormat } from './lib/compressImage';
import { compressPdfOnServer, PdfSettings } from './lib/pdfApi';

type Mode = 'image' | 'pdf';
type PdfMode = 'target' | 'preset';
type Preset = 'tinggi' | 'seimbang' | 'kecil';

const PRESETS: { key: Preset; label: string; desc: string }[] = [
  { key: 'tinggi', label: 'Sangat jernih', desc: 'Foto hampir sama dengan aslinya' },
  { key: 'seimbang', label: 'Seimbang', desc: 'Jernih dan ukuran turun jauh' },
  { key: 'kecil', label: 'Sekecil mungkin', desc: 'Foto masih terbaca, file paling kecil' },
];

const uid = () => Math.random().toString(36).slice(2);
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

export default function App() {
  const [mode, setMode] = useState<Mode>('pdf');
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);

  // pengaturan foto
  const [quality, setQuality] = useState(0.7);
  const [maxSize, setMaxSize] = useState(1920);
  const [format, setFormat] = useState<ImageFormat>('image/jpeg');
  // pengaturan PDF
  const [pdfMode, setPdfMode] = useState<PdfMode>('target');
  const [targetMB, setTargetMB] = useState(20);
  const [preset, setPreset] = useState<Preset>('seimbang');

  const patch = (id: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const switchMode = (m: Mode) => {
    if (running) return;
    setMode(m);
    setItems([]);
  };

  const addFiles = (files: File[]) =>
    setItems((prev) => [
      ...prev,
      ...files.map((file) => ({ id: uid(), file, status: 'waiting' as const, progress: 0 })),
    ]);

  const run = async () => {
    setRunning(true);
    for (const it of items.filter((i) => i.status !== 'done')) {
      patch(it.id, { status: 'working', progress: 0, error: undefined, note: undefined, message: undefined });
      try {
        if (mode === 'image') {
          const blob = await compressImage(it.file, { quality, maxSize, format });
          const ext = format === 'image/webp' ? 'webp' : 'jpg';
          patch(it.id, { status: 'done', progress: 100, result: blob, outName: `${baseName(it.file.name)}-compressed.${ext}` });
        } else {
          const settings: PdfSettings =
            pdfMode === 'target' ? { mode: 'target', targetMB } : { mode: 'preset', preset };
          const { id, result } = await compressPdfOnServer(it.file, settings, (u) =>
            patch(it.id, { progress: u.pct, message: u.message }),
          );
          patch(it.id, {
            status: 'done', progress: 100,
            outSize: result.outSize,
            downloadUrl: `api/jobs/${id}/download`,
            outName: `${baseName(it.file.name)}-compressed.pdf`,
            note: result.note,
          });
        }
      } catch (e) {
        patch(it.id, { status: 'error', error: e instanceof Error ? e.message : 'Terjadi kesalahan' });
      }
    }
    setRunning(false);
  };

  const tab = (m: Mode, label: string, icon: ReactNode) => (
    <button
      onClick={() => switchMode(m)}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition ${
        mode === m ? 'bg-red-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon} {label}
    </button>
  );

  const seg = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 text-center">
        <div className="mb-2 inline-flex items-center gap-2 text-3xl font-bold">
          <Minimize2 className="h-8 w-8 text-red-600" /> PDF Compress
        </div>
        <p className="text-slate-500">
          Perkecil ukuran foto dan PDF. {mode === 'pdf' ? 'Teks tetap tajam, hanya foto di dalam PDF yang dikecilkan.' : 'Diproses di browser, tidak diunggah.'}
        </p>
      </header>

      <div className="mb-6 flex gap-3 rounded-2xl bg-slate-200 p-1.5">
        {tab('image', 'Compress Foto', <ImageIcon className="h-5 w-5" />)}
        {tab('pdf', 'Compress PDF', <FileText className="h-5 w-5" />)}
      </div>

      <Dropzone
        key={mode}
        accept={mode === 'image' ? 'image/jpeg,image/png,image/webp' : '.pdf'}
        multiple
        label={mode === 'image' ? 'Tarik foto (JPG / PNG / WebP) ke sini' : 'Tarik file PDF ke sini (maks. 1,5 GB)'}
        onFiles={addFiles}
      />

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 font-semibold">Pengaturan</h2>

        {mode === 'image' ? (
          <div className="grid gap-5 sm:grid-cols-3">
            <label className="block text-sm">
              Kualitas: <b>{Math.round(quality * 100)}%</b>
              <input type="range" min={0.1} max={1} step={0.05} value={quality}
                onChange={(e) => setQuality(Number(e.target.value))} className="mt-2 w-full accent-red-600" />
            </label>
            <label className="block text-sm">
              Sisi terpanjang maks.
              <select value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))}
                className="mt-2 w-full rounded-lg border border-slate-300 p-2">
                <option value={0}>Ukuran asli</option>
                <option value={3840}>3840 px (4K)</option>
                <option value={1920}>1920 px (Full HD)</option>
                <option value={1280}>1280 px</option>
                <option value={800}>800 px</option>
              </select>
            </label>
            <label className="block text-sm">
              Format hasil
              <select value={format} onChange={(e) => setFormat(e.target.value as ImageFormat)}
                className="mt-2 w-full rounded-lg border border-slate-300 p-2">
                <option value="image/jpeg">JPG</option>
                <option value="image/webp">WebP (lebih kecil)</option>
              </select>
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button className={seg(pdfMode === 'target')} onClick={() => setPdfMode('target')}>Tentukan ukuran akhir</button>
              <button className={seg(pdfMode === 'preset')} onClick={() => setPdfMode('preset')}>Pilih kualitas</button>
            </div>

            {pdfMode === 'target' ? (
              <div>
                <label className="block text-sm">
                  Ukuran akhir yang diinginkan
                  <div className="mt-2 flex items-center gap-2">
                    <input type="number" min={0.5} step={0.5} value={targetMB}
                      onChange={(e) => setTargetMB(Number(e.target.value))}
                      className="w-28 rounded-lg border border-slate-300 p-2" />
                    <span className="text-slate-500">MB</span>
                    <div className="ml-2 flex flex-wrap gap-1.5">
                      {[5, 10, 20, 50, 100].map((v) => (
                        <button key={v} onClick={() => setTargetMB(v)} className={seg(targetMB === v)}>{v}</button>
                      ))}
                    </div>
                  </div>
                </label>
                <p className="mt-2 text-xs text-slate-500">
                  Sistem memilih kualitas foto terbaik yang masih muat di ukuran ini.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {PRESETS.map((p) => (
                  <button key={p.key} onClick={() => setPreset(p.key)}
                    className={`rounded-xl border p-3 text-left text-sm transition ${
                      preset === p.key ? 'border-red-600 bg-red-50' : 'border-slate-200 hover:border-red-300'
                    }`}>
                    <div className="font-semibold">{p.label}</div>
                    <div className="text-slate-500">{p.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {items.length > 0 && (
        <div className="mt-6 space-y-4">
          <ResultList items={items} onRemove={(id) => setItems((p) => p.filter((i) => i.id !== id))} />
          <button
            onClick={run}
            disabled={running || items.every((i) => i.status === 'done')}
            className="w-full rounded-xl bg-red-600 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {running ? 'Memproses…' : 'Compress Sekarang'}
          </button>
        </div>
      )}
    </div>
  );
}
