/**
 * A same-site path to return to after sign-in or OAuth, or `fallback`.
 * Browsers read "\" as "/" and drop tabs and newlines, so "/\evil.com" and
 * "/\t/evil.com" resolve to another site just like "//evil.com" does.
 */
export function safeNext(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  if (value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
