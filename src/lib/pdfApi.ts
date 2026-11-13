export interface PdfJobResult {
  inSize: number;
  outSize: number;
  imageCount: number;
  changed: number;
  reachedTarget: boolean;
  note?: string;
}

export type PdfSettings =
  | { mode: 'target'; targetMB: number }
  | { mode: 'preset'; preset: 'tinggi' | 'seimbang' | 'kecil' };

interface Update { pct: number; message: string }

/** Unggah PDF ke server lokal, tunggu proses selesai, kembalikan id job + ringkasan hasil. */
export function compressPdfOnServer(
  file: File,
  settings: PdfSettings,
  onUpdate: (u: Update) => void,
): Promise<{ id: string; result: PdfJobResult }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('mode', settings.mode);
    if (settings.mode === 'target') form.append('targetMB', String(settings.targetMB));
    else form.append('preset', settings.preset);
    form.append('file', file); // file paling akhir agar field lain terbaca duluan

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/compress');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUpdate({ pct: (e.loaded / e.total) * 25, message: 'Mengunggah file…' });
    };
    xhr.onerror = () => reject(new Error('Tidak bisa terhubung ke server. Pastikan "npm run dev" masih berjalan.'));
    xhr.onload = () => {
      let body: { id?: string; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* abaikan */ }
      if (xhr.status !== 200 || !body.id) return reject(new Error(body.error || 'Gagal mengunggah file.'));
      poll(body.id);
    };
    xhr.send(form);

    const poll = async (id: string) => {
      try {
        for (;;) {
          const r = await fetch(`api/jobs/${id}`);
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'Job tidak ditemukan');
          if (j.status === 'error') throw new Error(j.error);
          if (j.status === 'done') return resolve({ id, result: j.result as PdfJobResult });
          onUpdate({ pct: 25 + (j.pct / 100) * 75, message: j.message });
          await new Promise((res) => setTimeout(res, 600));
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Terjadi kesalahan'));
      }
    };
  });
}
