# VELLORA — Affiliate Intelligence

by Haidar Abdurrohman

VELLORA mengubah file ekspor affiliate (.xlsx / .xls / .csv) menjadi laporan visual yang rapi, lalu bisa diunduh sebagai **SVG, PDF, dan PNG resolusi tinggi**. Semua data diproses **di browser** — tidak ada file yang diunggah ke server.

## Menjalankan

```bash
npm install
npm run dev            # server pengembangan (http://localhost:5173)
npm run build          # build produksi → dist/
npm run preview        # menyajikan dist/
npm run build:preview  # satu file mandiri → VELLORA-preview.html (bisa dibuka langsung di HP)
npm test               # 49 tes data engine + scene engine
npm run fixtures       # buat ulang file contoh fiktif di tests/fixtures/
```

Parameter URL: `?intro` memutar intro, `?nointro` melewatinya. Intro otomatis hanya diputar pada kunjungan pertama (bisa diputar ulang lewat tombol "Putar intro").

## Alur

```
Upload file → parse (SheetJS, range dipulihkan dari sel nyata) → normalisasi (angka/tanggal Indonesia,
status, alias kolom) → gabung + dedupe (orderId|SKU) → agregasi (produk, penjualan, komisi, toko)
→ ReportModel → Report Scene (vektor) → preview SVG / ekspor SVG · PDF · PNG
```

- **Satu sumber kebenaran:** preview dan ketiga file unduhan dibuat dari objek `Scene` yang sama.
- **Renderer utama = SVG/vektor DOM.** Canvas hanya dipakai untuk latar PatternWaves, partikel intro, dan rasterisasi PNG dari SVG. Tidak memakai html2canvas / screenshot DOM (jsPDF `.html()` di-stub di `vite.config.ts`).
- **PDF**: jsPDF + svg2pdf.js, teks Inter asli (bisa dipilih), satu halaman persis seukuran artboard.
- **PNG**: SVG → gambar → canvas pada skala 2×/3×/4×, dengan batas aman memori (±16,7 MP, sisi maks 16.384 px) dan pesan jujur bila skala diturunkan.
- **HP:** halaman tidak pernah scroll horizontal; artboard di-fit ke lebar layar, dan "Mode HP" menyusun ulang laporan menjadi satu kolom (bukan sekadar mengecilkan).

## Struktur

```
src/
  app/            App.tsx (alur halaman), pipeline.ts (tahap proses nyata + timer)
  components/     intro (MaskedHeading, ParticleText, BlurText), background (PatternWaves),
                  controls (FuseButton, GlideSelect), upload, processing (LatticeLoader, ThoughtLine),
                  report (ReportPreview), export (ExportBar), feedback (PeekRating)
  data/           parser (readWorkbook), normalization (angka, tanggal, status, kolom), aggregation (merge)
  report-engine/  model → scene (layout rasio, seksi) → svg / pdf / png, templates, fonts
  lib/            format Rupiah/angka, download, util motion
tests/            data-engine.test.ts, scene.test.ts, fixtures/ (data FIKTIF)
public/           favicon.svg, samples/ (salinan fixture fiktif untuk tombol "Coba file contoh")
```

## Catatan data

- Nilai pada fixture hanya untuk **tes**. Tidak ada angka yang di-hard-code di laporan; semuanya dihitung dari file yang diunggah.
- Status dinormalisasi menjadi: `paid` (Sudah dibayar), `in_process` (Dalam proses), `awaiting_buyer` (Belum dibayar pembeli), `not_eligible` (Tidak memenuhi syarat), `unknown`. Jika kolom status tidak ada, status diambil dari nama file (mis. `selesai.xlsx`).
- Komisi memakai komisi aktual bila tersedia, jika tidak memakai estimasi. Order unik dihitung per ID pesanan.

## Feedback

Versi ini belum punya backend, jadi rating disimpan di `localStorage` perangkat dan teks UI menyatakannya dengan jujur. Variabel lingkungan untuk versi backend nanti ada di `.env.example` (`DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) — jangan pernah menulis nilainya di kode.
