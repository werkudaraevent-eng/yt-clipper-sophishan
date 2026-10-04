import { notFound, redirect } from "next/navigation";
import { lookOf, type CaptionWord, type ClipLook, type JobOptions } from "@clipper/shared";
import { AppShell } from "@/components/AppShell";
import { rupiah, salePrice, type Pack } from "@/lib/credit-packs";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { getPricingSettings } from "@/lib/pricing";
import { currentUser } from "@/lib/session";
import { CLIPS_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { ClipEditor, type Term } from "./editor";

const SIGNED_URL_SECONDS = 60 * 60;

type Row = {
  id: string;
  position: number;
  start_seconds: number;
  end_seconds: number;
  title: string | null;
  hook_text: string | null;
  caption_words: CaptionWord[] | null;
  render: Partial<ClipLook> | null;
  original_start: number | null;
  original_end: number | null;
  video_path: string | null;
  thumbnail_path: string | null;
};

export default async function EditClipPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { id, clipId } = await params;
  const user = await currentUser();
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);
  const supabase = await createClient();
  const projectHref = `/projects/${id}`;

  // RLS keeps every query to the owner's own rows.
  const [{ data: clip }, { data: project }, { count }, { data: paid }, { data: running }] = await Promise.all([
    supabase
      .from("clips")
      .select(
        "id, position, start_seconds, end_seconds, title, hook_text, caption_words, render, original_start, original_end, video_path, thumbnail_path",
      )
      .eq("id", clipId)
      .eq("project_id", id)
      .maybeSingle<Row>(),
    supabase.from("projects").select("status, options, duration_seconds").eq("id", id).maybeSingle(),
    supabase.from("clips").select("id", { count: "exact", head: true }).eq("project_id", id),
    supabase.from("credit_orders").select("id").eq("status", "paid").limit(1),
    supabase.from("jobs").select("id").eq("clip_id", clipId).in("status", ["queued", "running"]).limit(1),
  ]);
  if (!clip || !project) notFound();
  if (project.status !== "ready") redirect(projectHref);

  const buyer = Boolean(paid?.length);
  const paths = [clip.video_path, clip.thumbnail_path].filter((p): p is string => Boolean(p) && !p!.startsWith("/"));
  const [{ data: signed }, { data: terms }, { data: packs }, pricing] = await Promise.all([
    paths.length
      ? supabase.storage.from(CLIPS_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    buyer
      ? supabase.from("user_terms").select("id, wrong, correct").order("created_at").returns<Term[]>()
      : Promise.resolve({ data: [] as Term[] }),
    buyer
      ? Promise.resolve({ data: [] as Pack[] })
      : supabase.from("credit_packs").select("id, credits, price_idr, featured, discount_percent").returns<Pack[]>(),
    buyer ? null : getPricingSettings(),
  ]);
  const url = (path: string | null) => signed?.find((s) => s.path === path)?.signedUrl || undefined;
  const cheapest = (packs ?? [])
    .map((p) => ({ price: salePrice(p, pricing?.discount_until ?? null), credits: p.credits }))
    .sort((a, b) => a.price - b.price)[0];
  const options = project.options as JobOptions;

  return (
    <AppShell user={user} title={t.editor.title} backHref={projectHref} hideBottomNav>
      <ClipEditor
        clip={{
          id: clip.id,
          title: clip.title ?? `${t.project.clip} ${clip.position + 1}`,
          position: clip.position,
          count: count ?? 1,
          hook: clip.hook_text ?? "",
          start: clip.start_seconds,
          end: clip.end_seconds,
          aiStart: clip.original_start ?? clip.start_seconds,
          aiEnd: clip.original_end ?? clip.end_seconds,
          sourceEnd: project.duration_seconds,
          words: [...(clip.caption_words ?? [])].sort((a, b) => a.start - b.start),
          look: lookOf(clip.render, options),
          legacy: clip.render == null,
          video: url(clip.video_path),
          thumb: url(clip.thumbnail_path),
        }}
        buyer={buyer}
        terms={terms ?? []}
        cheapest={cheapest ? { price: rupiah(cheapest.price), credits: cheapest.credits } : null}
        busy={Boolean(running?.length)}
        projectHref={projectHref}
        locale={locale}
      />
    </AppShell>
  );
}
