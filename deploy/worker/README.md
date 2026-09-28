# Menjalankan worker (laptop atau VPS)

Spec VPS yang disarankan: 4 vCPU, 8 GB RAM, SSD 40–50 GB, Ubuntu 22.04/24.04,
tanpa GPU. Untuk rilis: 8 vCPU, 16 GB.

Worker mengambil antrean project dari Supabase, mengunduh video YouTube,
membuat transkrip, memanggil 9Router untuk memilih momen, merender klip, lalu
mengunggahnya ke bucket `clips`. Website di Vercel hanya membuat antrean; tanpa
worker, project akan tertahan di "Waiting for a worker…".

Langkah yang sama berlaku di laptop dan di VPS.

## 1. Pasang Docker

- Windows / Mac: pasang **Docker Desktop** dari docker.com, lalu buka sampai
  statusnya "running".
- Linux / VPS: `curl -fsSL https://get.docker.com | sh`

## 2. Ambil kode

```sh
git clone https://github.com/werkudaraevent-eng/yt-clipper-sophishan.git
cd yt-clipper-sophishan/deploy/worker
cp .env.worker.example .env.worker
```

## 3. Isi `.env.worker`

Buka file `.env.worker` dengan teks editor. Isinya rahasia: jangan dikirim ke
chat dan jangan di-commit.

Semua nilai Supabase diambil dari akun **hanungsastria13@gmail.com**,
organisasi **Sopishan**, project **sophishan-clipper**
(`hmegcnrpmyxqwqpeploj`). Bukan organisasi "sophishan" yang berisi Booth Hub.

| Isian | Dari mana |
| --- | --- |
| `DATABASE_URL` | Tombol **Connect** di atas dashboard project > **Session pooler**. Salin string-nya, lalu ganti `[YOUR-PASSWORD]` dengan password database. Lupa password? Database > Settings > Reset database password. |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings > API Keys: key **service_role** (diawali `eyJ`). |
| `CLIPPER_LLM_BASE_URL`, `CLIPPER_LLM_API_KEY`, `CLIPPER_LLM_MODEL` | Sama dengan yang dipakai untuk 9Router sekarang. Kalau 9Router jalan di mesin yang sama, alamatnya `http://host.docker.internal:<port>`. |

`SUPABASE_URL` sudah terisi.

## 4. Jalankan

```sh
docker compose up -d --build
docker compose logs -f
```

Build pertama makan waktu beberapa menit. Setelah jalan, log akan menampilkan
worker mengambil job; di website status project berubah dari "Queued" ke
tahap-tahap proses. Tekan Ctrl+C untuk berhenti melihat log (worker tetap jalan).

## Perintah lain

- Berhenti: `docker compose down`
- Update ke kode terbaru: `git pull && docker compose up -d --build`
- Worker menyala lagi otomatis setelah Docker/laptop dinyalakan ulang.

## Kalau YouTube menolak unduhan

Pesan seperti "Sign in to confirm you're not a bot" atau "The page needs to be
reloaded" berarti IP diblokir YouTube.
Dua cara mengatasinya:

- **Cookies**: ekspor cookies YouTube dari browser (format Netscape, misalnya
  lewat ekstensi "Get cookies.txt LOCALLY") dari **jendela Incognito**: login di
  Incognito, buka youtube.com/robots.txt, ekspor, lalu tutup jendela itu tanpa
  logout (supaya YouTube tidak merotasi cookies-nya). Simpan sebagai
  `deploy/worker/cookies.txt`, buka komentar baris `cookies.txt` di
  `docker-compose.yml`, lalu isi `YTDLP_COOKIES_FILE=/secrets/cookies.txt`.
  Pakai akun YouTube cadangan, bukan akun utama.
- **Proxy**: isi `YTDLP_PROXY` dengan alamat proxy residensial.

Lalu jalankan ulang: `docker compose up -d`.
