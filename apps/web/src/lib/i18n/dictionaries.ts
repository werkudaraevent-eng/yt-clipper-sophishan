export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "lang";

const en = {
  meta: { description: "Turn long YouTube videos into captioned 9:16 shorts." },
  header: { signIn: "Sign in", signOut: "Sign out", language: "Language", credits: "credits" },
  home: {
    previewMode: "Preview mode: Supabase is not configured, so projects cannot be created.",
    heroTitle: "Turn one long video into a week of shorts",
    heroSubtitle:
      "Paste a YouTube link. AI finds the best moments, frames the speaker for 9:16 and adds animated captions.",
    features: [
      { title: "Picks the moments", body: "Each clip comes with a title, a hook and a virality score." },
      { title: "Follows the face", body: "Auto layout keeps the speaker in frame, even when they move." },
      { title: "Captions that pop", body: "Word-by-word styles, translated into 19 languages if you want." },
    ],
    freeNote: "Free to start: 30 credits, 1 credit per minute of video processed.",
  },
  login: {
    title: "Sign in",
    subtitle: "Turn long videos into shorts in minutes.",
    notConfigured:
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    sent: "Check your inbox for a sign-in link.",
    google: "Continue with Google",
    or: "or",
    email: "Email",
    emailLink: "Email me a sign-in link",
  },
  create: {
    url: "YouTube URL",
    submit: "Get Shorts",
    starting: "Starting…",
    checkLanguage: "*Please check that the video language is correct",
    videoLanguage: "Video Language",
    autoDetect: "Auto detect",
    translation: "Caption Translation",
    translateTo: "Translate captions to",
    timeframe: "Processing Timeframe",
    clipLength: "Preferred Clip Length",
    clipLengths: { lt30: "<30s", "30to60": "30s~60s", "60to90": "60s~90s", original: "Original" },
    captions: "Captions",
    template: "Template",
    captionTemplate: "Caption template",
    position: "Caption position",
    positions: { bottom: "Bottom", middle: "Middle", top: "Top" },
    advanced: "Advanced Options",
    hookTitle: "Hook Title",
    hookHint: "A punchy line on screen for the first 3 seconds",
    wordsPerCaption: "Words Per Caption",
    layout: "Layout",
    layouts: { auto: "Auto", fill: "Fill", fit: "Fit", square: "Square" },
    layoutHint: "Auto follows the speaker's face. Fit keeps the whole frame on a blurred background.",
    direction: "AI direction (optional)",
    directionPlaceholder: 'e.g. "Focus on the money advice" or "Clip 2:00 - 2:50 exactly"',
    cost: "Uses {cost} credits · {balance} left",
    costUnknown: "Uses {cost} credits (1 per minute processed)",
  },
  errors: {
    notYoutube: "Not a YouTube video link",
    videoNotFound: "Video not found or not public",
    lookupFailed: "Could not look up the video",
    notConfigured: "Supabase is not configured on this server.",
    badForm: "Could not read the form.",
    createFailed: "Could not create the project.",
    insufficientCredits: "Not enough credits. Shorten the timeframe or top up.",
  },
  projects: {
    title: "Projects",
    total: "TOTAL",
    expiry: "Projects are subject to expire in 60 days",
    search: "Search by title...",
    status: "Status",
    statusAll: "Status: All",
    sort: "Sort",
    newest: "Newest first",
    oldest: "Oldest first",
    apply: "Apply",
    empty: "No projects yet. Paste a link above.",
    untitled: "Untitled",
    clips: "clips",
  },
  status: {
    queued: "Queued",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed",
    expired: "Expired",
  },
  project: {
    failed: "Processing failed:",
    unknownError: "unknown error",
    notUploaded: "File not uploaded",
    clip: "Clip",
    download: "Download",
    expired: "This project expired after 60 days and its clips were deleted.",
  },
  progress: {
    stages: {
      download: "Downloading video",
      transcribe: "Reading the transcript",
      analyze: "Finding the best moments",
      render: "Rendering clips",
      upload: "Saving clips",
    },
    retrying: "Retrying",
    after: "after:",
    waiting: "Waiting for a worker…",
  },
  admin: {
    link: "Admin",
    title: "Admin: credits",
    searchLabel: "User email",
    search: "Find user",
    notFound: "No user with that email.",
    name: "Name",
    plan: "Plan",
    balance: "Credits",
    amount: "Amount (use a minus sign to deduct)",
    note: "Reason",
    notePlaceholder: "e.g. paid via bank transfer",
    apply: "Apply",
    done: "Saved. New balance: {balance} credits.",
    errors: {
      belowZero: "That would take the balance below 0.",
      badAmount: "Enter a whole number other than 0.",
      failed: "Could not save the change.",
    },
  },
};

export type Dictionary = typeof en;

const id: Dictionary = {
  meta: { description: "Ubah video YouTube panjang jadi shorts 9:16 lengkap dengan caption." },
  header: { signIn: "Masuk", signOut: "Keluar", language: "Bahasa", credits: "kredit" },
  home: {
    previewMode: "Mode pratinjau: Supabase belum dikonfigurasi, jadi project belum bisa dibuat.",
    heroTitle: "Satu video panjang, jadi shorts untuk seminggu",
    heroSubtitle:
      "Tempel link YouTube. AI mencari momen terbaik, membingkai pembicara ke 9:16, dan menambahkan caption animasi.",
    features: [
      { title: "Memilih momen terbaik", body: "Setiap klip punya judul, hook, dan skor viral." },
      { title: "Mengikuti wajah", body: "Layout otomatis menjaga pembicara tetap di frame, meski bergerak." },
      { title: "Caption yang menarik", body: "Gaya kata per kata, bisa diterjemahkan ke 19 bahasa." },
    ],
    freeNote: "Gratis untuk mulai: 30 kredit, 1 kredit per menit video yang diproses.",
  },
  login: {
    title: "Masuk",
    subtitle: "Ubah video panjang jadi shorts dalam hitungan menit.",
    notConfigured:
      "Supabase belum dikonfigurasi. Isi NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    sent: "Cek email kamu untuk link masuk.",
    google: "Lanjut dengan Google",
    or: "atau",
    email: "Email",
    emailLink: "Kirim link masuk ke email",
  },
  create: {
    url: "URL YouTube",
    submit: "Buat Shorts",
    starting: "Memulai…",
    checkLanguage: "*Pastikan bahasa video sudah benar",
    videoLanguage: "Bahasa Video",
    autoDetect: "Deteksi otomatis",
    translation: "Terjemahkan Caption",
    translateTo: "Terjemahkan caption ke",
    timeframe: "Rentang Waktu Diproses",
    clipLength: "Panjang Klip",
    clipLengths: { lt30: "<30 dtk", "30to60": "30~60 dtk", "60to90": "60~90 dtk", original: "Asli" },
    captions: "Caption",
    template: "Template",
    captionTemplate: "Template caption",
    position: "Posisi caption",
    positions: { bottom: "Bawah", middle: "Tengah", top: "Atas" },
    advanced: "Opsi Lanjutan",
    hookTitle: "Judul Hook",
    hookHint: "Kalimat pemikat di layar selama 3 detik pertama",
    wordsPerCaption: "Kata per Caption",
    layout: "Layout",
    layouts: { auto: "Otomatis", fill: "Penuh", fit: "Pas", square: "Persegi" },
    layoutHint:
      "Otomatis mengikuti wajah pembicara. Pas menampilkan seluruh frame di atas latar yang diburamkan.",
    direction: "Arahan untuk AI (opsional)",
    directionPlaceholder: 'mis. "Fokus ke tips keuangan" atau "Potong persis 2:00 - 2:50"',
    cost: "Memakai {cost} kredit · sisa {balance}",
    costUnknown: "Memakai {cost} kredit (1 per menit yang diproses)",
  },
  errors: {
    notYoutube: "Bukan link video YouTube",
    videoNotFound: "Video tidak ditemukan atau tidak publik",
    lookupFailed: "Gagal mengambil info video",
    notConfigured: "Supabase belum dikonfigurasi di server ini.",
    badForm: "Form tidak bisa dibaca.",
    createFailed: "Project gagal dibuat.",
    insufficientCredits: "Kredit tidak cukup. Persingkat rentang waktu atau isi ulang kredit.",
  },
  projects: {
    title: "Project",
    total: "TOTAL",
    expiry: "Project otomatis kedaluwarsa setelah 60 hari",
    search: "Cari judul...",
    status: "Status",
    statusAll: "Status: Semua",
    sort: "Urutkan",
    newest: "Terbaru dulu",
    oldest: "Terlama dulu",
    apply: "Terapkan",
    empty: "Belum ada project. Tempel link di atas.",
    untitled: "Tanpa judul",
    clips: "klip",
  },
  status: {
    queued: "Antre",
    processing: "Diproses",
    ready: "Siap",
    failed: "Gagal",
    expired: "Kedaluwarsa",
  },
  project: {
    failed: "Pemrosesan gagal:",
    unknownError: "error tidak diketahui",
    notUploaded: "File belum diunggah",
    clip: "Klip",
    download: "Unduh",
    expired: "Project ini sudah kedaluwarsa setelah 60 hari dan klipnya sudah dihapus.",
  },
  progress: {
    stages: {
      download: "Mengunduh video",
      transcribe: "Membaca transkrip",
      analyze: "Mencari momen terbaik",
      render: "Merender klip",
      upload: "Menyimpan klip",
    },
    retrying: "Mencoba lagi",
    after: "setelah:",
    waiting: "Menunggu worker…",
  },
  admin: {
    link: "Admin",
    title: "Admin: kredit",
    searchLabel: "Email user",
    search: "Cari user",
    notFound: "Tidak ada user dengan email itu.",
    name: "Nama",
    plan: "Paket",
    balance: "Kredit",
    amount: "Jumlah (pakai tanda minus untuk mengurangi)",
    note: "Alasan",
    notePlaceholder: "mis. bayar via transfer bank",
    apply: "Simpan",
    done: "Tersimpan. Saldo baru: {balance} kredit.",
    errors: {
      belowZero: "Saldo tidak boleh kurang dari 0.",
      badAmount: "Isi bilangan bulat selain 0.",
      failed: "Perubahan gagal disimpan.",
    },
  },
};

export const DICTIONARIES: Record<Locale, Dictionary> = { en, id };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Locale from an Accept-Language header: Indonesian/Malay speakers get "id". */
export function localeFromAcceptLanguage(header: string | null): Locale {
  const first = (header ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("id") || first.startsWith("ms") ? "id" : DEFAULT_LOCALE;
}

/** Fill {name} placeholders in a dictionary string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));
}
