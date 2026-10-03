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
