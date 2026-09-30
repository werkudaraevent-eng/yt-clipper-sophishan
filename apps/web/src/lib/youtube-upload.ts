import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { safeNext as safeNextPath } from "./safe-next";

/**
 * Posting clips to the user's YouTube channel: Google OAuth with the upload
 * scope, the refresh token encrypted at rest, and a resumable upload.
 * Everything here needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and
 * SOCIAL_TOKEN_KEY (32 random bytes, base64); without them the feature hides.
 */

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const TOKEN_KEY = process.env.SOCIAL_TOKEN_KEY;

export const youtubePostingEnabled = Boolean(CLIENT_ID && CLIENT_SECRET && TOKEN_KEY);

export const YOUTUBE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/youtube.upload"];
export const PRIVACY = ["public", "unlisted", "private"] as const;
export type Privacy = (typeof PRIVACY)[number];

function key() {
  const k = Buffer.from(TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("SOCIAL_TOKEN_KEY must be 32 bytes, base64-encoded");
  return k;
}

/** "v1:" + base64(iv | tag | ciphertext), AES-256-GCM. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decryptToken(sealed: string): string {
  const raw = Buffer.from(sealed.replace(/^v1:/, ""), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Where Google sends the user back after consent. */
export function callbackUrl(url: URL) {
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? url.origin}/api/youtube/callback`;
}

/** Only same-site paths; see lib/safe-next. */
export function safeNext(value: string | null) {
  return safeNextPath(value, "/projects");
}

export function authUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google returns a refresh token even on a reconnect.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, ...body }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    scope?: string;
    error?: string;
  };
  if (!res.ok) throw new YouTubeError(json.error === "invalid_grant" ? "reconnect" : "failed", json.error);
  return json;
}

/** Exchanges the OAuth code; returns the refresh token and the Google account email. */
export async function exchangeCode(code: string, redirectUri: string) {
  const json = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!json.refresh_token) throw new YouTubeError("failed", "no refresh token");
  if (!json.scope?.includes("youtube.upload")) throw new YouTubeError("scope", "upload scope not granted");
  // The ID token comes straight from Google's token endpoint over TLS, so its
  // payload can be read without verifying the signature.
  const payload = json.id_token?.split(".")[1];
  const email = payload
    ? ((JSON.parse(Buffer.from(payload, "base64url").toString()) as { email?: string }).email ?? null)
    : null;
  return { refreshToken: json.refresh_token, email };
}

export async function accessToken(refreshToken: string) {
  const json = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  return json.access_token!;
}

export async function revoke(refreshToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
  }).catch(() => {});
}

export class YouTubeError extends Error {
  code: "reconnect" | "scope" | "quota" | "failed";

  constructor(code: YouTubeError["code"], detail?: string) {
    super(detail ?? code);
    this.code = code;
  }
}

/**
 * Uploads a video with YouTube's resumable protocol: one request for the
 * metadata, one PUT streaming the file. Returns the video id and channel title.
 */
export async function uploadVideo(
  token: string,
  file: { body: ReadableStream<Uint8Array>; size: number },
  meta: { title: string; description: string; privacy: Privacy },
) {
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": "video/mp4",
        "x-upload-content-length": String(file.size),
      },
      body: JSON.stringify({
        snippet: { title: meta.title, description: meta.description, categoryId: "22" },
        status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!init.ok) throw await apiError(init);
  const location = init.headers.get("location");
  if (!location) throw new YouTubeError("failed", "no upload location");

  const put = await fetch(location, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "content-length": String(file.size) },
    body: file.body,
    // Node's fetch needs this to stream a request body.
    duplex: "half",
  } as RequestInit);
  if (!put.ok) throw await apiError(put);
  const video = (await put.json()) as { id: string; snippet?: { channelTitle?: string } };
  return { id: video.id, channelTitle: video.snippet?.channelTitle ?? null };
}

async function apiError(res: Response) {
  const text = await res.text();
  if (res.status === 401) return new YouTubeError("reconnect", text.slice(0, 300));
  if (/quotaExceeded|uploadLimitExceeded|rateLimitExceeded/.test(text)) {
    return new YouTubeError("quota", text.slice(0, 300));
  }
  return new YouTubeError("failed", `${res.status} ${text.slice(0, 300)}`);
}

/** YouTube caps titles at 100 characters and rejects angle brackets. */
export function cleanTitle(title: string) {
  return title.replace(/[<>]/g, "").trim().slice(0, 100) || "Short";
}

export function cleanDescription(text: string) {
  return text.replace(/[<>]/g, "").slice(0, 4900);
}
