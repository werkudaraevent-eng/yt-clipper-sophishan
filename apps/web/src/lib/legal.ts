import type { Locale } from "@/lib/i18n/dictionaries";

/** A legal page: sections of paragraphs. `{contact}` becomes the support email. */
export type LegalDoc = { title: string; updated: string; sections: { heading: string; body: string[] }[] };

const YT_TERMS = "https://www.youtube.com/t/terms";
const GOOGLE_PRIVACY = "https://policies.google.com/privacy";
const GOOGLE_PERMISSIONS = "https://myaccount.google.com/permissions";
const GOOGLE_LIMITED_USE = "https://developers.google.com/terms/api-services-user-data-policy";

const privacyEn: LegalDoc = {
  title: "Privacy Policy",
  updated: "Last updated 29 September 2026",
  sections: [
    {
      heading: "Who we are",
      body: [
        "Sophishan Clipper turns long YouTube videos into short vertical clips. This policy explains what we collect, why, and the choices you have. Questions go to {contact}.",
      ],
    },
    {
      heading: "What we collect",
      body: [
        "Account: your email address and name from the sign-in method you choose (email link or Google).",
        "Projects: the YouTube links you submit, the settings you pick, the transcript we read from the video, and the clips we render.",
        "Credits: your balance and a history of what used or added credits.",
        "Connected YouTube channel: if you connect YouTube, a refresh token that lets us upload clips you choose to your channel, and the email address of that Google account.",
        "Technical: cookies that keep you signed in and remember your language and theme.",
      ],
    },
    {
      heading: "How we use it",
      body: [
        "To run the service: find highlights, render clips, keep your projects and credits, and upload a clip to YouTube only when you press Post and confirm.",
        "The video transcript is sent to our AI provider to pick highlights and write titles. It is not used to train models on our side.",
        "We do not sell your data or use it for advertising.",
      ],
    },
    {
      heading: "YouTube and Google data",
      body: [
        "Posting to YouTube uses the YouTube API Services. By connecting your channel you also agree to the YouTube Terms of Service (" +
          YT_TERMS +
          "), and Google's Privacy Policy (" +
          GOOGLE_PRIVACY +
          ") applies to the data Google handles.",
        "We ask only for permission to upload videos and to see the email address of the account. We cannot read, edit or delete your existing videos.",
        "Our use of information received from Google APIs adheres to the Google API Services User Data Policy (" +
          GOOGLE_LIMITED_USE +
          "), including the Limited Use requirements.",
        "You can disconnect YouTube at any time from a project page, which deletes the stored token, or revoke access from your Google account at " +
          GOOGLE_PERMISSIONS +
          ".",
      ],
    },
    {
      heading: "Where data is stored and for how long",
      body: [
        "Data is stored with Supabase (database, sign-in and file storage) and the website runs on Vercel. Clips are processed on our own server.",
        "Rendered clips are deleted 60 days after the project is created. Account data and credit history are kept while your account exists.",
        "Refresh tokens are encrypted and deleted when you disconnect YouTube or delete your account.",
      ],
    },
    {
      heading: "Your choices",
      body: [
        "You can ask us to export or delete your account and its data by writing to {contact}. We reply within 30 days.",
      ],
    },
    {
      heading: "Changes",
      body: ["If we change this policy we update the date above and, for significant changes, tell you in the app."],
    },
  ],
};

const privacyId: LegalDoc = {
  title: "Kebijakan Privasi",
  updated: "Terakhir diperbarui 29 September 2026",
  sections: [
    {
      heading: "Tentang kami",
      body: [
        "Sophishan Clipper mengubah video YouTube panjang menjadi klip vertikal pendek. Kebijakan ini menjelaskan data apa yang kami kumpulkan, untuk apa, dan pilihan yang kamu punya. Pertanyaan bisa dikirim ke {contact}.",
      ],
    },
    {
      heading: "Data yang kami kumpulkan",
      body: [
        "Akun: alamat email dan nama dari cara masuk yang kamu pilih (link email atau Google).",
        "Proyek: link YouTube yang kamu kirim, pengaturan yang kamu pilih, transkrip yang kami baca dari video, dan klip yang kami buat.",
        "Kredit: saldo dan riwayat pemakaian atau penambahan kredit.",
        "Channel YouTube yang terhubung: jika kamu menghubungkan YouTube, refresh token yang memungkinkan kami mengunggah klip yang kamu pilih ke channel-mu, serta alamat email akun Google tersebut.",
        "Teknis: cookie untuk menjaga kamu tetap masuk serta mengingat bahasa dan tema.",
      ],
    },
    {
      heading: "Cara kami memakainya",
      body: [
        "Untuk menjalankan layanan: mencari momen terbaik, membuat klip, menyimpan proyek dan kredit, dan mengunggah klip ke YouTube hanya saat kamu menekan Post dan mengonfirmasi.",
        "Transkrip video dikirim ke penyedia AI kami untuk memilih momen dan menulis judul. Kami tidak memakainya untuk melatih model.",
        "Kami tidak menjual datamu dan tidak memakainya untuk iklan.",
      ],
    },
    {
      heading: "Data YouTube dan Google",
      body: [
        "Posting ke YouTube memakai YouTube API Services. Dengan menghubungkan channel, kamu juga menyetujui Persyaratan Layanan YouTube (" +
          YT_TERMS +
          "), dan Kebijakan Privasi Google (" +
          GOOGLE_PRIVACY +
          ") berlaku untuk data yang ditangani Google.",
        "Kami hanya meminta izin untuk mengunggah video dan melihat alamat email akun tersebut. Kami tidak bisa membaca, mengubah, atau menghapus video yang sudah ada.",
        "Penggunaan informasi yang kami terima dari Google API mengikuti Google API Services User Data Policy (" +
          GOOGLE_LIMITED_USE +
          "), termasuk ketentuan Limited Use.",
        "Kamu bisa memutus YouTube kapan saja dari halaman proyek, yang menghapus token tersimpan, atau mencabut akses dari akun Google-mu di " +
          GOOGLE_PERMISSIONS +
          ".",
      ],
    },
    {
      heading: "Tempat dan lama penyimpanan",
      body: [
        "Data disimpan di Supabase (database, login, dan penyimpanan file) dan website berjalan di Vercel. Klip diproses di server kami sendiri.",
        "Klip dihapus 60 hari setelah proyek dibuat. Data akun dan riwayat kredit disimpan selama akunmu ada.",
        "Refresh token disimpan terenkripsi dan dihapus saat kamu memutus YouTube atau menghapus akun.",
      ],
    },
    {
      heading: "Pilihanmu",
      body: [
        "Kamu bisa meminta ekspor atau penghapusan akun beserta datanya dengan menulis ke {contact}. Kami membalas dalam 30 hari.",
      ],
    },
    {
      heading: "Perubahan",
      body: [
        "Jika kebijakan ini berubah, tanggal di atas kami perbarui dan untuk perubahan penting kami beri tahu di aplikasi.",
      ],
    },
  ],
};

const termsEn: LegalDoc = {
  title: "Terms of Service",
  updated: "Last updated 29 September 2026",
  sections: [
    {
      heading: "The service",
      body: [
        "Sophishan Clipper finds highlights in YouTube videos you submit and renders them as short vertical clips, which you can download or post to your own YouTube channel.",
      ],
    },
    {
      heading: "Your content",
      body: [
        "Only submit videos you own or have permission to use. You are responsible for the clips you publish and for following the rules of the platforms you post to, including the YouTube Terms of Service (" +
          YT_TERMS +
          ").",
        "We do not claim ownership of your videos or clips.",
      ],
    },
    {
      heading: "Credits",
      body: [
        "Processing costs 1 credit per started minute of video. Credits are charged when a project is created and refunded automatically if processing fails. Credits have no cash value.",
      ],
    },
    {
      heading: "Acceptable use",
      body: [
        "Do not use the service to infringe copyright, to publish illegal or harmful content, or to work around the service's limits.",
        "We may suspend accounts that break these terms.",
      ],
    },
    {
      heading: "Availability and liability",
      body: [
        "We work to keep the service running but provide it as is. Clips are deleted after 60 days, so download what you want to keep.",
        "To the extent the law allows, our liability is limited to the amount you paid us in the last 3 months.",
      ],
    },
    {
      heading: "Contact",
      body: ["Questions about these terms go to {contact}."],
    },
  ],
};

const termsId: LegalDoc = {
  title: "Syarat Layanan",
  updated: "Terakhir diperbarui 29 September 2026",
  sections: [
    {
      heading: "Layanan",
      body: [
        "Sophishan Clipper mencari momen terbaik dari video YouTube yang kamu kirim dan membuatnya menjadi klip vertikal pendek, yang bisa kamu unduh atau posting ke channel YouTube-mu sendiri.",
      ],
    },
    {
      heading: "Kontenmu",
      body: [
        "Kirim hanya video milikmu atau yang sudah kamu dapatkan izinnya. Kamu bertanggung jawab atas klip yang kamu publikasikan dan wajib mengikuti aturan platform tujuan, termasuk Persyaratan Layanan YouTube (" +
          YT_TERMS +
          ").",
        "Kami tidak mengklaim kepemilikan atas video atau klipmu.",
      ],
    },
    {
      heading: "Kredit",
      body: [
        "Pemrosesan memakai 1 kredit per menit video yang mulai diproses. Kredit dipotong saat proyek dibuat dan dikembalikan otomatis jika pemrosesan gagal. Kredit tidak bisa diuangkan.",
      ],
    },
    {
      heading: "Penggunaan yang dilarang",
      body: [
        "Jangan memakai layanan ini untuk melanggar hak cipta, menyebarkan konten ilegal atau berbahaya, atau mengakali batasan layanan.",
        "Kami bisa menangguhkan akun yang melanggar syarat ini.",
      ],
    },
    {
      heading: "Ketersediaan dan tanggung jawab",
      body: [
        "Kami berusaha menjaga layanan tetap berjalan, tetapi layanan diberikan apa adanya. Klip dihapus setelah 60 hari, jadi unduh yang ingin kamu simpan.",
        "Sejauh diizinkan hukum, tanggung jawab kami terbatas pada jumlah yang kamu bayarkan kepada kami dalam 3 bulan terakhir.",
      ],
    },
    {
      heading: "Kontak",
      body: ["Pertanyaan tentang syarat ini bisa dikirim ke {contact}."],
    },
  ],
};

export const LEGAL: Record<"privacy" | "terms", Record<Locale, LegalDoc>> = {
  privacy: { en: privacyEn, id: privacyId },
  terms: { en: termsEn, id: termsId },
};
