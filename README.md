# PDF Compress

Website untuk mengompres **PDF** (dengan foto/evidence di dalamnya) dan **foto**.

## Cara kerja kompres PDF
Hanya **gambar yang tertanam** di dalam PDF yang dikecilkan (resolusi + kualitas JPEG).
Teks, tabel, logo, dan tata letak **tidak disentuh**, jadi hasilnya tetap tajam dan teks tetap bisa diseleksi.
Kamu bisa menentukan **ukuran akhir (MB)**, lalu sistem memilih kualitas foto terbaik yang masih muat.

Stack: React 19 + Vite + TypeScript + Tailwind v4 (frontend), Express + sharp + pdf-lib (server).

## Jalankan
```bash
npm install
npm run dev
```
Buka http://localhost:3000

## Mode production (opsional)
```bash
npm run build
npm start
```

Catatan: file PDF diproses di komputer/server tempat aplikasi berjalan (maks. 1,5 GB).
