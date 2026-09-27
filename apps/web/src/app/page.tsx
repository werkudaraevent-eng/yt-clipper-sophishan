import { CLIP_LENGTHS, LAYOUTS } from "@clipper/shared";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-bold">Sophishan Clipper</h1>
      <p className="text-slate-500">
        Paste a YouTube link and get captioned 9:16 shorts for TikTok, Reels and Shorts.
      </p>
      <form className="flex gap-2">
        <input
          type="url"
          disabled
          placeholder="https://www.youtube.com/watch?v=..."
          className="flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="button"
          disabled
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white opacity-60"
        >
          Get Shorts
        </button>
      </form>
      <p className="text-xs text-slate-500">
        Coming soon: clip lengths {CLIP_LENGTHS.join(", ")} · layouts {LAYOUTS.join(", ")}
      </p>
    </main>
  );
}
