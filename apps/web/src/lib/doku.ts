import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * DOKU Checkout (non-SNAP API): a hosted payment page for QRIS, virtual
 * accounts and e-wallets. Requests and notifications are signed with
 * HMAC-SHA256 over Client-Id, Request-Id, Request-Timestamp, Request-Target
 * and a SHA-256 digest of the body.
 * https://developers.doku.com/accept-payments/doku-checkout
 */
const CLIENT_ID = process.env.DOKU_CLIENT_ID;
const SECRET_KEY = process.env.DOKU_SECRET_KEY;
const BASE_URL =
  process.env.DOKU_ENV === "production" ? "https://api.doku.com" : "https://api-sandbox.doku.com";

/** Path DOKU posts payment results to; also the Request-Target of their signature. */
export const NOTIFY_PATH = "/api/payments/doku/notify";

export const dokuConfigured = Boolean(CLIENT_ID && SECRET_KEY);

/** UTC ISO 8601 without milliseconds, as DOKU expects. */
function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function digest(body: string) {
  return createHash("sha256").update(body, "utf8").digest("base64");
}

export function signature(parts: {
  clientId: string;
  requestId: string;
  timestamp: string;
  target: string;
  body?: string;
  secret: string;
}) {
  let component =
    `Client-Id:${parts.clientId}\nRequest-Id:${parts.requestId}\n` +
    `Request-Timestamp:${parts.timestamp}\nRequest-Target:${parts.target}`;
  if (parts.body != null) component += `\nDigest:${digest(parts.body)}`;
  return "HMACSHA256=" + createHmac("sha256", parts.secret).update(component).digest("base64");
}

async function call(method: "GET" | "POST", target: string, payload?: unknown) {
  if (!CLIENT_ID || !SECRET_KEY) throw new Error("DOKU is not configured");
  const requestId = randomUUID();
  const ts = timestamp();
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const res = await fetch(BASE_URL + target, {
    method,
    headers: {
      "Client-Id": CLIENT_ID,
      "Request-Id": requestId,
      "Request-Timestamp": ts,
      Signature: signature({ clientId: CLIENT_ID, requestId, timestamp: ts, target, body, secret: SECRET_KEY }),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep null; the status code tells the caller what happened
  }
  return { status: res.status, json };
}

/** DOKU's "yyyyMMddHHmmss" in Jakarta time (UTC+7). */
function parseJakarta(value: unknown): string | null {
  const m = typeof value === "string" && value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`).toISOString();
}

export async function createCheckout(order: {
  invoiceNumber: string;
  amount: number;
  itemName: string;
  resultUrl: string;
  notifyUrl: string;
  customer: { id: string; email?: string | null; name?: string | null };
  locale: string;
}): Promise<{ url: string; expiresAt: string | null }> {
  const { status, json } = await call("POST", "/checkout/v1/payment", {
    order: {
      amount: order.amount,
      invoice_number: order.invoiceNumber,
      currency: "IDR",
      callback_url: order.resultUrl,
      callback_url_result: order.resultUrl,
      auto_redirect: true,
      language: order.locale === "id" ? "ID" : "EN",
      line_items: [{ id: order.invoiceNumber, name: order.itemName, quantity: 1, price: order.amount }],
    },
    payment: { payment_due_date: 60 },
    customer: {
      id: order.customer.id,
      ...(order.customer.email ? { email: order.customer.email } : {}),
      ...(order.customer.name ? { name: order.customer.name } : {}),
    },
    additional_info: { override_notification_url: order.notifyUrl },
  });
  const payment = (json as { response?: { payment?: { url?: string; expired_date?: string } } })?.response
    ?.payment;
  if (status !== 200 || !payment?.url) {
    throw new Error(`DOKU checkout failed (${status}): ${JSON.stringify(json)?.slice(0, 300)}`);
  }
  return { url: payment.url, expiresAt: parseJakarta(payment.expired_date) };
}

export type DokuStatus = "SUCCESS" | "FAILED" | "PENDING" | "EXPIRED";

/** Payment status by invoice number, or null when DOKU has no transaction yet. */
export async function checkStatus(
  invoiceNumber: string,
): Promise<{ status: DokuStatus; amount: number | null; channel: string | null } | null> {
  const { status, json } = await call("GET", `/orders/v1/status/${encodeURIComponent(invoiceNumber)}`);
  if (status === 404) return null;
  const data = json as {
    transaction?: { status?: string };
    order?: { amount?: number | string };
    channel?: { id?: string };
  } | null;
  const s = data?.transaction?.status;
  if (status !== 200 || !s) return null;
  return {
    status: s as DokuStatus,
    amount: data?.order?.amount != null ? Number(data.order.amount) : null,
    channel: data?.channel?.id ?? null,
  };
}

/** True when a notification's Signature header matches its body. */
export function verifyNotification(headers: Headers, rawBody: string): boolean {
  if (!CLIENT_ID || !SECRET_KEY) return false;
  const clientId = headers.get("client-id");
  const requestId = headers.get("request-id");
  const ts = headers.get("request-timestamp");
  const given = headers.get("signature");
  if (clientId !== CLIENT_ID || !requestId || !ts || !given) return false;
  const expected = signature({ clientId, requestId, timestamp: ts, target: NOTIFY_PATH, body: rawBody, secret: SECRET_KEY });
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
