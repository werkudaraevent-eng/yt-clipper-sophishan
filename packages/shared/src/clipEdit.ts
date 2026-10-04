import { z } from "zod";
import { CAPTION_POSITIONS, CAPTION_TEMPLATES, LAYOUTS, type JobOptions } from "./jobOptions";

/**
 * One saved edit of a finished clip, as the editor sends it to edit_clip.
 * The worker validates the same shape with pydantic (ClipEdit in
 * services/worker/clipper_worker/options.py); both are tested against
 * fixtures/clip-edit.*.json. Only what changed is set.
 */

export const captionWordSchema = z.object({
  text: z.string().min(1).max(80),
  start: z.number().min(0),
  end: z.number().min(0),
});

export const clipStyleSchema = z.object({
  template: z.enum(CAPTION_TEMPLATES).optional(),
  position: z.enum(CAPTION_POSITIONS).optional(),
  wordsPerCaption: z.number().int().min(1).max(6).optional(),
  layout: z.enum(LAYOUTS).optional(),
  hookTitle: z.boolean().optional(),
  coldOpen: z.boolean().optional(),
});

export const clipEditSchema = z
  .object({
    /** The captions over the clip's current range, in video seconds. */
    words: z.array(captionWordSchema).max(3000).optional(),
    hook: z.string().max(120).optional(),
    start: z.number().min(0).optional(),
    end: z.number().positive().optional(),
    style: clipStyleSchema.optional(),
  })
  .refine((e) => e.start === undefined || e.end === undefined || e.end - e.start >= 3, {
    message: "a clip runs at least 3 seconds",
    path: ["end"],
  });

export type CaptionWord = z.infer<typeof captionWordSchema>;
export type ClipStyle = z.infer<typeof clipStyleSchema>;
export type ClipEdit = z.infer<typeof clipEditSchema>;

/** How far a trim may move the clip past the AI's cut, and its length limits (see edit_clip). */
export const TRIM_REACH_SECONDS = 30;
export const MIN_CLIP_SECONDS = 3;
export const MAX_CLIP_SECONDS = 180;

/** How a clip's file was rendered (clips.render); see render.describe in the worker. */
export type ClipLook = Required<ClipStyle> & { teaser: [number, number] | null };

/** The clip's look; clips from before the editor were rendered with the project's options. */
export function lookOf(render: Partial<ClipLook> | null, options: JobOptions): ClipLook {
  return {
    template: options.captions.template,
    position: options.captions.position,
    wordsPerCaption: options.captions.wordsPerCaption,
    layout: options.layout,
    hookTitle: options.hookTitle,
    coldOpen: options.coldOpen,
    teaser: null,
    ...(render ?? {}),
  };
}
