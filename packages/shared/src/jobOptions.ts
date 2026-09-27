import { z } from "zod";

/**
 * Options a user picks on the Create page. The worker validates the same
 * shape with pydantic (services/worker/clipper_worker/options.py); both sides
 * are tested against fixtures/job-options.*.json so they cannot drift.
 */

export const CLIP_LENGTHS = ["lt30", "30to60", "60to90", "original"] as const;
export const CAPTION_TEMPLATES = ["karaoke", "box", "ali"] as const;
export const CAPTION_POSITIONS = ["top", "middle", "bottom"] as const;
export const LAYOUTS = ["auto", "fill", "fit", "square"] as const;

/** Seconds range per clip-length choice; `original` keeps the model's own cut. */
export const CLIP_LENGTH_RANGES: Record<(typeof CLIP_LENGTHS)[number], [number, number] | null> = {
  lt30: [10, 30],
  "30to60": [30, 60],
  "60to90": [60, 90],
  original: null,
};

const YOUTUBE_URL =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]{11}/;

const languageCode = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, "ISO language code");

export const jobOptionsSchema = z
  .object({
    youtubeUrl: z.string().regex(YOUTUBE_URL, "Not a YouTube video URL"),
    videoLanguage: z.union([z.literal("auto"), languageCode]).default("auto"),
    captionTranslation: languageCode.nullable().default(null),
    timeframe: z.object({
      start: z.number().min(0),
      end: z.number().positive(),
    }),
    clipLength: z.enum(CLIP_LENGTHS).default("30to60"),
    captions: z
      .object({
        enabled: z.boolean().default(true),
        template: z.enum(CAPTION_TEMPLATES).default("karaoke"),
        position: z.enum(CAPTION_POSITIONS).default("bottom"),
        wordsPerCaption: z.number().int().min(1).max(6).default(3),
      })
      .default({}),
    hookTitle: z.boolean().default(true),
    layout: z.enum(LAYOUTS).default("auto"),
    aiDirection: z.string().max(1000).default(""),
  })
  .refine((o) => o.timeframe.end > o.timeframe.start, {
    message: "timeframe.end must be after timeframe.start",
    path: ["timeframe", "end"],
  });

export type JobOptionsInput = z.input<typeof jobOptionsSchema>;
export type JobOptions = z.output<typeof jobOptionsSchema>;
