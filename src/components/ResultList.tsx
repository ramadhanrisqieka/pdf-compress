import { Download, Loader2, X, AlertCircle, Info } from 'lucide-react';
import { downloadBlob, formatBytes, savedPercent } from '../lib/format';

export interface Item {
  id: string;
  file: File;
  status: 'waiting' | 'working' | 'done' | 'error';
  progress: number;
  message?: string;
  result?: Blob;          // hasil di browser (foto)
  outSize?: number;       // ukuran hasil di server (PDF)
  downloadUrl?: string;   // link unduh dari server (PDF)
  outName?: string;
  note?: string;
  error?: string;
}

interface Props {
  items: Item[];
  onRemove: (id: string) => void;
}

export default function ResultList({ items, onRemove }: Props) {
  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const outSize = it.result?.size ?? it.outSize;
        const pct = outSize !== undefined ? savedPercent(it.file.size, outSize) : 0;
        return (
          <li key={it.id} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{it.file.name}</p>
              <p className="text-sm text-slate-500">
                {formatBytes(it.file.size)}
                {outSize !== undefined && (
                  <>
                    {' → '}
                    <span className="font-semibold text-emerald-600">{formatBytes(outSize)}</span>
                    {pct > 0 ? ` (hemat ${pct}%)` : ' (tidak lebih kecil)'}
                  </>
                )}
              </p>
              {it.status === 'working' && (
                <>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-100">
                    <div className="h-full bg-red-600 transition-all" style={{ width: `${Math.round(it.progress)}%` }} />
                  </div>
                  {it.message && <p className="mt-1 text-xs text-slate-500">{it.message}</p>}
                </>
              )}
              {it.note && (
                <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {it.note}
                </p>
              )}
              {it.status === 'error' && (
                <p className="mt-1 flex items-center gap-1 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4" /> {it.error}
                </p>
              )}
            </div>

            {it.status === 'working' && <Loader2 className="h-5 w-5 animate-spin text-red-600" />}
            {it.status === 'done' && it.downloadUrl && (
              <a
                href={it.downloadUrl}
                download={it.outName}
                className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                <Download className="h-4 w-4" /> Unduh
              </a>
            )}
            {it.status === 'done' && it.result && (
              <button
                onClick={() => downloadBlob(it.result!, it.outName!)}
                className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                <Download className="h-4 w-4" /> Unduh
              </button>
            )}
            <button onClick={() => onRemove(it.id)} className="text-slate-400 hover:text-slate-700" aria-label="Hapus">
              <X className="h-5 w-5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
