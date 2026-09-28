/** YouTube helpers that run on the web server (no yt-dlp here). */

const ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/;

export function youtubeId(url: string): string | null {
  return url.match(ID_RE)?.[1] ?? null;
}

export type VideoMeta = {
  id: string;
  title: string;
  author: string | null;
  thumbnail: string;
  /** Seconds, or null when YouTube did not tell us. */
  duration: number | null;
};

/**
 * Title and thumbnail from oEmbed (stable, keyless). Duration is read from the
 * watch page, which is best effort: the worker clamps the timeframe to the real
 * length anyway.
 */
export async function fetchVideoMeta(id: string): Promise<VideoMeta | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const oembed = await fetch(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`,
    { next: { revalidate: 3600 } },
  );
  if (!oembed.ok) return null;
  const data = (await oembed.json()) as { title?: string; author_name?: string };

  let duration: number | null = null;
  try {
    const page = await fetch(watchUrl, {
      headers: { "accept-language": "en" },
      next: { revalidate: 3600 },
    });
    const match = (await page.text()).match(/"lengthSeconds":"(\d+)"/);
    if (match) duration = Number(match[1]);
  } catch {
    duration = null;
  }

  return {
    id,
    title: data.title ?? id,
    author: data.author_name ?? null,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration,
  };
}
