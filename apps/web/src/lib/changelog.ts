import type { Locale } from "./i18n/dictionaries";

/**
 * Release notes shown on /changelog ("What's new"). Newest first. Add an entry
 * with every change a user would notice; the top bar shows a dot until the
 * visitor has opened the page since the newest `date`.
 */
export type ChangeKind = "new" | "improved" | "fixed";

type Text = Record<Locale, string>;

export type Release = {
  /** Release day, YYYY-MM-DD. Also what "seen" is compared against. */
  date: string;
  title: Text;
  items: { kind: ChangeKind; title: Text; body: Text }[];
};

export const RELEASES: Release[] = [
  {
    date: "2026-10-08",
    title: {
      id: "Crop lebih tepat ke orang yang bicara",
      en: "The crop finds the speaker more reliably",
    },
    items: [
      {
        kind: "fixed",
        title: {
          id: "Orang yang diam tidak lagi disorot",
          en: "Silent listeners no longer framed",
        },
        body: {
          id: "Gerak bibir tiap orang kini dicocokkan dengan suara, jadi pendengar yang tersenyum, mengangguk, atau ketawa tanpa suara tidak lagi dikira sedang bicara.",
          en: "Each person's lip movement is now matched against the voice, so a listener who smiles, nods or laughs silently is no longer mistaken for the speaker.",
        },
      },
    ],
  },
  {
    date: "2026-10-04",
    title: {
      id: "Edit klip, diskon, kode promo, dan ajak teman",
      en: "Clip editor, discounts, promo codes and invites",
    },
    items: [
      {
        kind: "new",
        title: { id: "Perbaiki caption sebelum diunduh", en: "Fix captions before you download" },
        body: {
          id: "Tekan tombol pensil di kartu klip untuk mengubah judul hook dan teks caption, atau mengganti nama yang salah tulis di semua caption sekaligus. Klip dirender ulang sekitar 1–2 menit, gratis untuk semua akun.",
          en: "Tap the pencil on a clip card to change the hook title and caption text, or fix a misspelled name in every caption at once. The clip renders again in about 1–2 minutes, free for every account.",
        },
      },
      {
        kind: "new",
        title: { id: "Potong ulang dan ganti gaya", en: "Re-cut and restyle" },
        body: {
          id: "Pembeli paket kredit bisa menggeser awal dan akhir klip sampai 30 detik, menyalakan atau mematikan teaser pembuka, dan mengganti template caption, posisi, serta layout setelah klip jadi.",
          en: "Credit buyers can move a clip's start and end by up to 30 seconds, turn the opening teaser on or off, and change the caption template, position and layout after the clip is made.",
        },
      },
      {
        kind: "new",
        title: { id: "Kamus nama", en: "Name dictionary" },
        body: {
          id: "Pembeli paket kredit bisa menyimpan nama yang sering salah ditulis, misalnya “Mateus Kunya” jadi “Matheus Cunha”. Caption video berikutnya langsung memakai penulisan yang benar.",
          en: "Credit buyers can save names that often come out wrong, like “Mateus Kunya” for “Matheus Cunha”. Captions on their next videos use the right spelling.",
        },
      },
      {
        kind: "new",
        title: { id: "Diskon paket kredit", en: "Credit pack discounts" },
        body: {
          id: "Saat ada diskon, halaman Kredit menampilkan harga coret dan sampai kapan diskonnya berlaku.",
          en: "When a discount runs, the Credits page shows the struck-through price and when the discount ends.",
        },
      },
      {
        kind: "new",
        title: { id: "Kode promo", en: "Promo codes" },
        body: {
          id: "Punya kode promo? Masukkan di jendela konfirmasi sebelum bayar, harganya langsung terpotong.",
          en: "Got a promo code? Enter it in the confirm window before you pay and the price drops right away.",
        },
      },
      {
        kind: "new",
        title: { id: "Ajak teman, dapat kredit", en: "Invite friends, earn credits" },
        body: {
          id: "Bagikan link undanganmu dari halaman Kredit. Saat temanmu membeli kredit pertama kali, kamu dapat kredit gratis.",
          en: "Share your invite link from the Credits page. When your friend buys credits for the first time, you get free credits.",
        },
      },
      {
        kind: "new",
        title: {
          id: "Split 2, 3, atau 4 orang",
          en: "Split for 2, 3 or 4 people",
        },
        body: {
          id: "Di mode Auto, saat dua orang saling sahut atau beberapa orang ketawa bareng, layar otomatis dibagi supaya semuanya terlihat. Di luar momen itu, crop tetap fokus ke satu orang yang sedang bicara.",
          en: "In Auto layout, when two people trade lines or a group laughs together, the screen splits so everyone is visible. Otherwise the crop stays on the one person talking.",
        },
      },
      {
        kind: "new",
        title: { id: "Antrean prioritas untuk pembeli kredit", en: "Priority queue for credit buyers" },
        body: {
          id: "Kalau kamu pernah beli paket kredit, project-mu masuk jalur prioritas dan biasanya mulai jauh lebih cepat saat antrean ramai. Pengguna gratis tetap kebagian giliran: setiap project ketiga diambil dari antrean biasa.",
          en: "If you've ever bought a credit pack, your projects go in the priority lane and usually start much sooner when the queue is busy. Free users still get their turn: every third project is taken from the regular line.",
        },
      },
      {
        kind: "improved",
        title: { id: "Video yang paling cocok", en: "Videos that work best" },
        body: {
          id: "Di bawah kolom link ada petunjuk bahwa hasil terbaik datang dari video yang banyak ngobrol. Halaman depan juga punya tanya jawab soal video yang cocok, kredit, dan lama klip disimpan.",
          en: "A line under the link field says the best results come from talk-heavy videos. The front page also answers common questions about which videos fit, credits, and how long clips are kept.",
        },
      },
    ],
  },
  {
    date: "2026-10-03",
    title: {
      id: "Jadwalkan posting di jam ramai penontonmu",
      en: "Schedule posts for when your viewers are around",
    },
    items: [
      {
        kind: "new",
        title: { id: "Jadwalkan posting", en: "Scheduled posts" },
        body: {
          id: "Saat posting ke YouTube, pilih Jadwalkan dan ambil salah satu jam yang disarankan. Klip diunggah sendiri di jam itu, walau kamu sedang offline.",
          en: "When you post to YouTube, choose Schedule and pick one of the suggested times. The clip goes up on its own, even while you're offline.",
        },
      },
      {
        kind: "new",
        title: { id: "Jadwalkan beberapa klip sekaligus", en: "Schedule several clips at once" },
        body: {
          id: "Pilih beberapa klip di hasil proyek, lalu klip dibagi 1 atau 2 per hari di jam ramai.",
          en: "Select several clips in a project's results and they're spread out, 1 or 2 a day, at busy hours.",
        },
      },
      {
        kind: "new",
        title: { id: "Halaman Jadwal", en: "Schedule page" },
        body: {
          id: "Lihat antrean posting per hari, ubah jam atau batalkan, dan lihat view 24 jam pertama tiap Shorts. Setelah 10 posting, saran jam memakai data channel-mu sendiri.",
          en: "See your posting queue by day, change a time or cancel, and check each Short's first-day views. After 10 posts, suggestions use your own channel's data.",
        },
      },
      {
        kind: "fixed",
        title: { id: "Link email tidak lagi gagal", en: "Email links no longer fail" },
        body: {
          id: "Link masuk dan konfirmasi dari email kini tetap jalan walau dibuka di browser atau HP lain, dan emailnya datang dari login@sofish.tech dengan tampilan Sophishan.",
          en: "Sign-in and confirmation links now work even when opened in another browser or phone, and the email comes from login@sofish.tech with the Sophishan look.",
        },
      },
      {
        kind: "new",
        title: { id: "Posisi antrean dan perkiraan mulai", en: "Queue position and start estimate" },
        body: {
          id: "Saat project masih menunggu, halamannya menunjukkan posisimu di antrean, berapa project di depanmu, dan kira-kira kapan mulai diproses.",
          en: "While a project is waiting, its page shows your place in the queue, how many projects are ahead of you, and roughly when it will start.",
        },
      },
      {
        kind: "new",
        title: { id: "Kabari saya saat klip siap", en: "Notify me when clips are ready" },
        body: {
          id: "Tidak perlu menunggu di halaman project. Kami kirim email begitu klip jadi, atau kalau gagal beserta kabar bahwa kreditnya kembali. Bisa juga lewat notifikasi browser, dan bisa dimatikan dari sakelar di kartu progres.",
          en: "No need to wait on the project page. We email you when the clips are done, or if it fails, with word that the credits are back. Browser notifications work too, and the switch on the progress card turns it off.",
        },
      },
      {
        kind: "fixed",
        title: { id: "Download tidak lagi macet di 2%", en: "Downloads no longer stall at 2%" },
        body: {
          id: "Saat kamu memilih sebagian video, potongannya kini diunduh langsung tanpa diolah ulang, jadi jauh lebih cepat dan persentasenya terus bergerak.",
          en: "When you pick part of a video, that section is now fetched as is instead of being re-encoded, so it's much faster and the percentage keeps moving.",
        },
      },
      {
        kind: "improved",
        title: { id: "Caption pas dengan omongan", en: "Captions in sync with the speech" },
        body: {
          id: "Caption kini dibuat dari suara video itu sendiri, bukan dari subtitle YouTube. Kata muncul tepat saat diucapkan, dan omongan campuran Indonesia-Inggris tetap tertulis benar.",
          en: "Captions are now made from the video's own audio instead of YouTube's subtitles. Words show up as they're said, and talk that mixes Indonesian and English comes out right.",
        },
      },
    ],
  },
  {
    date: "2026-10-02",
    title: {
      id: "Crop tetap di orang yang sedang bercerita",
      en: "The crop stays on whoever is telling the story",
    },
    items: [
      {
        kind: "fixed",
        title: { id: "Fokus crop di podcast", en: "Crop focus in podcasts" },
        body: {
          id: "Di video berisi beberapa orang, crop vertikal kini mengikuti orang yang sedang bicara, bukan wajah terbesar. Tawa, teriakan, atau sahutan singkat dari orang lain tidak lagi memindahkan crop.",
          en: "In videos with several people, the vertical crop now follows whoever is talking instead of the biggest face. A laugh, a shout or a quick reply from someone else no longer moves it.",
        },
      },
    ],
  },
  {
    date: "2026-09-30",
    title: {
      id: "Cold open dan hook yang bikin orang berhenti scroll",
      en: "Cold open and hooks that stop the scroll",
    },
    items: [
      {
        kind: "new",
        title: { id: "Cold open", en: "Cold open" },
        body: {
          id: "Klip dibuka dengan 2–5 detik paling kuat sebagai teaser, lalu diputar dari awal. Aktif otomatis, bisa dimatikan di Pengaturan lanjutan.",
          en: "Clips open with their strongest 2–5 seconds as a teaser, then play from the start. On by default; turn it off in Advanced settings.",
        },
      },
      {
        kind: "improved",
        title: { id: "Hook lebih tajam", en: "Sharper hooks" },
        body: {
          id: "Teks hook di layar kini berupa pertanyaan singkat yang baru terjawab di dalam klip, tidak lagi membocorkan intinya.",
          en: "The on-screen hook is now a short question the clip answers, instead of giving the point away.",
        },
      },
      {
        kind: "improved",
        title: { id: "Link video lengkap", en: "Full video link" },
        body: {
          id: "Deskripsi posting YouTube otomatis menyertakan judul dan link video aslinya, langsung ke menit klip itu.",
          en: "When you post to YouTube, the description names the original video and links to the minute the clip comes from.",
        },
      },
      {
        kind: "improved",
        title: { id: "Login lebih aman", en: "Safer sign-in" },
        body: {
          id: "Login lewat email kini dilindungi verifikasi Cloudflare untuk menahan bot.",
          en: "Email sign-in is now protected by a Cloudflare check that keeps bots out.",
        },
      },
      {
        kind: "fixed",
        title: { id: "Subtitle pembuka", en: "Opening subtitle" },
        body: {
          id: "Kata terakhir dari kalimat sebelumnya tidak lagi ikut muncul di subtitle pertama.",
          en: "The last word of the previous sentence no longer shows up in the first subtitle.",
        },
      },
    ],
  },
  {
    date: "2026-09-29",
    title: {
      id: "Beli kredit dan posting langsung ke YouTube",
      en: "Buy credits and post straight to YouTube",
    },
    items: [
      {
        kind: "new",
        title: { id: "Beli kredit", en: "Buy credits" },
        body: {
          id: "Isi kredit sekali bayar lewat QRIS, virtual account, atau e-wallet. Kredit masuk otomatis begitu pembayaran berhasil.",
          en: "Top up with a one-time payment by QRIS, virtual account or e-wallet. Credits arrive as soon as the payment goes through.",
        },
      },
      {
        kind: "new",
        title: { id: "Posting ke YouTube", en: "Post to YouTube" },
        body: {
          id: "Hubungkan channel-mu, lalu kirim klip ke YouTube Shorts langsung dari halaman proyek.",
          en: "Connect your channel and send clips to YouTube Shorts right from the project page.",
        },
      },
      {
        kind: "improved",
        title: { id: "Potongan lebih rapi", en: "Cleaner cuts" },
        body: {
          id: "Awal dan akhir klip kini jatuh di jeda bicara, jadi tidak ada kalimat yang terpotong di tengah.",
          en: "Clips now start and end on a pause in speech, so no sentence is cut off halfway.",
        },
      },
      {
        kind: "fixed",
        title: { id: "Mode gelap", en: "Dark mode" },
        body: {
          id: "Teks pilihan di dropdown kini terbaca jelas di mode gelap.",
          en: "Dropdown options are now easy to read in dark mode.",
        },
      },
    ],
  },
  {
    date: "2026-09-28",
    title: { id: "Sophishan Clipper dibuka", en: "Sophishan Clipper opens" },
    items: [
      {
        kind: "new",
        title: { id: "Klip otomatis", en: "Automatic clips" },
        body: {
          id: "Tempel link YouTube, AI memilih momen terbaik dan menjadikannya klip 9:16 lengkap dengan subtitle.",
          en: "Paste a YouTube link and AI picks the best moments and turns them into captioned 9:16 clips.",
        },
      },
      {
        kind: "new",
        title: { id: "Tampilan baru", en: "New look" },
        body: {
          id: "Desain yang nyaman di desktop maupun HP, dengan mode terang dan gelap.",
          en: "A design that works on desktop and phone, with light and dark modes.",
        },
      },
      {
        kind: "new",
        title: { id: "30 kredit gratis", en: "30 free credits" },
        body: {
          id: "Setiap akun baru langsung mendapat 30 kredit untuk mencoba.",
          en: "Every new account gets 30 credits to try it out.",
        },
      },
    ],
  },
];

export const LATEST_RELEASE = RELEASES[0].date;

/** Cookie holding the newest release date the visitor has seen on /changelog. */
export const CHANGELOG_SEEN_COOKIE = "changelog_seen";

export function hasUnseenRelease(seen: string | undefined): boolean {
  return !seen || seen < LATEST_RELEASE;
}

/** "30 Sep 2026" / "Sep 30, 2026". Dates are calendar days, so format them in UTC. */
export function releaseDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
