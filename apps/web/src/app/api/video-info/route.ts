import { fetchVideoMeta, youtubeId } from "@/lib/youtube";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  const id = youtubeId(url);
  if (!id) return Response.json({ code: "notYoutube" }, { status: 400 });
  const meta = await fetchVideoMeta(id);
  if (!meta) {
    return Response.json({ code: "videoNotFound" }, { status: 404 });
  }
  return Response.json(meta);
}
