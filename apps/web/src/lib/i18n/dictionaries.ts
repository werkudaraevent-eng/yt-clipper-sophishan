export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "lang";

const en = {
  meta: { description: "Turn long YouTube videos into captioned 9:16 shorts." },
  header: { signIn: "Sign in", signOut: "Sign out", language: "Language" },
  home: { previewMode: "Preview mode: Supabase is not configured, so projects cannot be created." },
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
  },
  errors: {
    notYoutube: "Not a YouTube video link",
    videoNotFound: "Video not found or not public",
    lookupFailed: "Could not look up the video",
    notConfigured: "Supabase is not configured on this server.",
    badForm: "Could not read the form.",
    createFailed: "Could not create the project.",
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
};

export type Dictionary = typeof en;

const id: Dictionary = {
  meta: { description: "Ubah video YouTube panjang jadi shorts 9:16 lengkap dengan caption." },
  header: { signIn: "Masuk", signOut: "Keluar", language: "Bahasa" },
  home: { previewMode: "Mode pratinjau: Supabase belum dikonfigurasi, jadi project belum bisa dibuat." },
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
  },
  errors: {
    notYoutube: "Bukan link video YouTube",
    videoNotFound: "Video tidak ditemukan atau tidak publik",
    lookupFailed: "Gagal mengambil info video",
    notConfigured: "Supabase belum dikonfigurasi di server ini.",
    badForm: "Form tidak bisa dibaca.",
    createFailed: "Project gagal dibuat.",
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
