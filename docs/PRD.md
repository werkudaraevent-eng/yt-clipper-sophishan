# PRD: Sophishan Clipper (nama kerja)

Status: **Draft v0.1, menunggu review** · Pemilik: Hanung · Tanggal: 27 Sep 2026

## 1. Ringkasan

Platform web (SaaS) yang mengubah video YouTube panjang menjadi beberapa klip
pendek vertikal 9:16 siap posting ke TikTok, Reels, dan Shorts. Pengguna cukup
menempelkan URL, memilih bahasa, rentang waktu, panjang klip, dan gaya caption,
lalu sistem memilih momen terbaik dengan AI, memotong, me-reframe ke portrait
mengikuti wajah pembicara, dan membakar caption animasi kata per kata.

Kelas produk yang sama dengan Ssemble, OpusClip, Vizard, dan Klap. Target
awal: kreator dan "clipper" berbahasa Indonesia dan Inggris, dengan UI dan
dukungan bahasa global.

## 2. Hasil review repo referensi (`jipraks/yt-short-clipper`)

| Aspek | Temuan | Implikasi untuk kita |
|---|---|---|
| Bentuk | Aplikasi desktop **Windows-only** (Tauri + React + sidecar Python) | Kita bangun **web app multi-user**; logika Python bisa diadaptasi ke worker server |
| Lisensi | MIT | Boleh dipakai ulang/diadaptasi dengan menyertakan notice lisensi |
| Pipeline | yt-dlp → subtitle YouTube (json3, timing per kata) → LLM pilih highlight → potong section → reframe 9:16 → caption ASS via FFmpeg/libass | Pipeline ini sudah terbukti; kita ikuti urutan yang sama |
| Highlight AI | Prompt kuat (jumlah klip pasti, bahasa output, "AI direction" teks bebas, rentang jam eksplisit dihormati, temperature rendah bila ada arahan) | Adopsi pola prompt + validasi durasi |
| Reframe | 3 mode: face tracking (MediaPipe), centered black bars, centered blur | Petakan ke layout **Auto / Fill / Fit / Square** |
| Caption | Satu gaya (karaoke kuning, 4 kata/baris), font dari `C:\Windows\Fonts` | Perlu **sistem template** (Karaoke, Box, dst) + font dibundel |
| Transkrip | Hanya dari subtitle YouTube, tanpa Whisper | Butuh **fallback ASR** untuk video tanpa subtitle |
| Download | Butuh `cookies.txt` user; sering 403 | Risiko terbesar di server: IP datacenter diblokir YouTube (lihat §9) |
| Lainnya | Hook text overlay, watermark, upload via Repliz, dompet kredit QRIS | Hook & watermark masuk MVP; auto-posting pasca-MVP |

Kesimpulan: repo referensi bagus sebagai **mesin pemrosesan**, tapi hampir semua
lapisan produk (akun, antrean job, penyimpanan, template, billing, skala)
harus dibangun baru.

## 3. Tujuan dan non-tujuan

**Tujuan MVP**
1. Dari URL YouTube ke 3–10 klip 9:16 bercaption dalam < 10 menit untuk video 60 menit.
2. Kualitas setara Ssemble untuk fitur inti di screenshot (bahasa, terjemahan
   caption, timeframe, panjang klip, template caption, hook title, layout).
3. Multi-user dengan kuota/kredit, siap diakses publik.

**Non-tujuan MVP** (masuk roadmap): editor timeline penuh, auto-posting ke
sosial media, b-roll AI, meme hook, mode Sports, aplikasi mobile native, API publik.

## 4. Persona

- **Clipper**: memotong podcast/video orang lain untuk program "dibayar per
  view". Butuh volume tinggi dan cepat.
- **Kreator/brand**: merepurpose konten sendiri ke short-form. Butuh branding
  (watermark, CTA, end screen).
- **Agensi**: beberapa channel sekaligus (pasca-MVP: workspace tim).

## 5. Alur pengguna utama

1. Login (Google atau email magic link).
2. Tempel URL → sistem ambil metadata (judul, thumbnail, durasi, bahasa terdeteksi).
3. Atur opsi (lihat §6) → **Get Shorts**. Estimasi kredit ditampilkan sebelum mulai.
4. Halaman project menampilkan progres per tahap (download, transkrip, analisis AI, render klip).
5. Hasil: grid klip dengan skor viral, judul, hook, deskripsi. Preview, unduh MP4,
   ubah caption/teks lalu render ulang.
6. Daftar project dengan pencarian, filter status, urutkan; project kedaluwarsa setelah 60 hari.

## 6. Fitur dan prioritas

P0 = MVP, P1 = segera setelah MVP, P2 = nanti.

| Fitur (sesuai screenshot) | Prioritas | Catatan implementasi |
|---|---|---|
| Input URL YouTube + preview embed | P0 | Validasi URL, ambil metadata via yt-dlp |
| Video Language (deteksi + override) | P0 | Dari track subtitle; override menentukan bahasa ASR |
| Caption Translation | P0 | Terjemahkan per segmen via LLM, pertahankan timing |
| Processing Timeframe (slider) | P0 | Hanya rentang ini yang diunduh & dianalisis (hemat biaya) |
| Preferred clip length (<30s, 30–60s, 60–90s, Original) | P0 | Parameter ke prompt + filter durasi |
| Captions on/off + Template (Karaoke, Box, Ali, …) | P0 | Template = preset ASS (font, warna, highlight, animasi); 3 template di MVP |
| Caption position | P0 | Atas / tengah / bawah |
| Words per caption | P0 | 1–6 kata |
| Hook Title | P0 | Teks hook di 3 detik pertama, dibuat LLM |
| Layout Auto / Fill / Fit / Square | P0 | Auto = face tracking; Fill = crop tengah; Fit = blur background; Square = 1:1 |
| Project list, status, expiry 60 hari | P0 | |
| AI direction (instruksi teks bebas) | P0 | Diambil dari repo referensi |
| Watermark/logo | P1 | |
| Call To Action | P1 | Teks/tombol overlay di akhir klip |
| End screen | P1 | Kartu penutup 2–3 detik |
| Background music | P1 | Library musik bebas royalti + ducking |
| Text / Image / Video overlay | P1 | |
| Edit caption & re-render | P1 | |
| Video type: Sports | P2 | Tracking objek/aksi, bukan wajah |
| Meme hook | P2 | |
| B-roll otomatis | P2 | Stock footage API (Pexels) |
| Auto-post ke TikTok/YT/IG | P2 | OAuth tiap platform |
| Upload file lokal (bukan hanya YouTube) | P1 | Juga jadi jalan keluar bila YouTube memblokir |

## 7. Arsitektur dan tech stack

```
[Browser] ──► [Next.js app di Vercel] ──► [Supabase: Auth, Postgres, Storage]
                                              ▲
                                              │ polling job (SKIP LOCKED)
                                  [Worker Python di Docker/VM, opsional GPU]
                                   yt-dlp · FFmpeg · MediaPipe · faster-whisper
                                              │
                                        [Claude API]
```

| Lapisan | Pilihan default | Alasan |
|---|---|---|
| Frontend + API | **Next.js 15** (App Router), TypeScript, Tailwind, shadcn/ui | Satu codebase untuk UI dan API route; deploy mudah di Vercel |
| Auth, DB, file | **Supabase** (Postgres + Auth + Storage, Row Level Security) | Satu layanan untuk tiga kebutuhan; connector Supabase sudah tersedia di project ini |
| Antrean job | Tabel `jobs` di Postgres + `FOR UPDATE SKIP LOCKED` | Tanpa Redis di MVP; bisa diganti Redis/Celery saat skala naik |
| Worker | **Python 3.12** di Docker, dijalankan di VM (Hetzner/Railway/Fly) | FFmpeg & MediaPipe tidak bisa jalan di serverless Vercel |
| Download | yt-dlp + cookies + proxy residensial | Lihat risiko §9 |
| Transkrip | 1) subtitle YouTube json3 (timing per kata), 2) fallback **faster-whisper** | Gratis bila subtitle ada; whisper untuk sisanya |
| LLM | **Claude** (default `claude-opus-5`, bisa diganti lewat `CLIPPER_LLM_MODEL`, misalnya `claude-sonnet-5` untuk menekan biaya) | Pilih highlight, hook, judul, terjemahan |
| Reframe | Deteksi wajah YuNet (OpenCV) + smoothing, FFmpeg crop | Lebih ringan dari MediaPipe, tanpa dependensi tambahan |
| Caption | File ASS + libass (FFmpeg), font dibundel (Montserrat, Poppins, dll) | Template = konfigurasi JSON → ASS |
| Penyimpanan video | Supabase Storage (MVP), antarmuka S3 agar bisa pindah ke Cloudflare R2 | R2 tanpa biaya egress saat trafik besar |
| Billing | P1: **Stripe** (global) + **Xendit** (QRIS/VA untuk IDR) | |
| i18n UI | `next-intl`, EN + ID di MVP | |
| Observabilitas | Sentry + log job di DB | |

### Struktur repo (monorepo)

```
apps/web/          Next.js app
services/worker/   Pipeline Python (download, transcribe, highlight, render)
packages/shared/   Tipe & skema opsi job (JSON Schema) dipakai web + worker
supabase/          Migrasi SQL, RLS policy
docs/              PRD, ADR, runbook
```

## 8. Model data (awal)

- `profiles` (id, nama, plan, kredit_tersisa, bahasa_ui)
- `projects` (id, user_id, youtube_url, judul, thumbnail, durasi, bahasa_video,
  opsi JSON, status, expires_at)
- `jobs` (id, project_id, tipe, status, progress, attempt, error, locked_by, locked_at)
- `clips` (id, project_id, start, end, judul, hook, deskripsi, skor, url_video,
  url_thumbnail, caption_words JSON, status)
- `templates` (id, nama, konfigurasi ASS JSON, preview_url)
- `credit_ledger` (id, user_id, delta, alasan, project_id)

Kredit dihitung per menit video yang diproses (mirip Ssemble/OpusClip).

## 9. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| YouTube memblokir download dari IP server (bot check, 403) | Tinggi: pipeline berhenti | Cookies akun khusus yang dirotasi, proxy residensial, update yt-dlp rutin, fallback upload file manual |
| Hak cipta / ToS YouTube | Hukum & reputasi | ToS kita mewajibkan user punya hak atas konten; tombol laporan DMCA; hapus otomatis 60 hari |
| Biaya komputasi render | Margin | Hanya unduh rentang timeframe, preset encode cepat, GPU opsional, kuota per plan |
| Akurasi pilihan highlight | Kepuasan user | Prompt teruji dari referensi, skor + alasan per klip, opsi AI direction |
| Video tanpa subtitle | Tidak bisa diproses | faster-whisper fallback |

Catatan: produk ini memakai nama dan brand sendiri, tidak meniru brand Ssemble.

## 10. Metrik sukses MVP

- ≥ 90% job selesai tanpa error (di luar URL privat/terhapus).
- Waktu proses median < 10 menit per 60 menit video.
- ≥ 40% klip hasil diunduh user (proxy kualitas highlight).
- 50 user aktif mingguan pertama dalam 1 bulan setelah rilis.

## 11. Milestone

Tiap milestone = satu atau beberapa PR yang bisa direview terpisah.

| # | Milestone | Isi | Definisi selesai |
|---|---|---|---|
| M0 | Fondasi | PRD ini, monorepo, Supabase schema + RLS, CI (lint, typecheck, test), Docker worker | `docker compose up` menjalankan web + worker lokal |
| M1 | Mesin clipping (CLI) | Download section, transkrip (YT + whisper), highlight Claude, potong, reframe 4 layout, caption karaoke, hook title | Perintah CLI: URL → folder MP4 klip bercaption |
| M2 | Aplikasi web inti | Login, halaman Create (sesuai screenshot), antrean job, progres realtime, halaman hasil, unduh, daftar project | User bisa end-to-end di browser |
| M3 | Template & bahasa | 3 template caption + posisi + kata per caption, terjemahan caption, clip length, i18n EN/ID | Semua opsi P0 di §6 berfungsi |
| M4 | Monetisasi & rilis | Kredit, plan Free/Pro, Stripe + Xendit, expiry 60 hari, Sentry, deploy produksi, landing page | **MVP publik, ready to use** |
| M5 | Fitur P1 | Watermark, CTA, end screen, musik latar, overlay, edit caption & re-render, upload file lokal | |
| M6 | Fitur P2 | Sports mode, meme hook, b-roll, auto-posting, workspace tim, API | |

## 12. Pertanyaan terbuka untuk Hanung

1. **Nama & domain produk**: sementara "Sophishan Clipper".
2. **Hosting worker**: default VM Hetzner CPU (murah) dulu, GPU saat volume naik. Setuju?
3. **Supabase & Vercel**: pakai akun yang sudah terhubung di project ini?
4. **Harga**: acuan Ssemble/OpusClip (Free ~30 menit/bulan, Pro ~US$15–29). Mau dalam IDR juga?
5. **LLM**: Claude sebagai default; perlu opsi OpenAI/Gemini sejak awal?
