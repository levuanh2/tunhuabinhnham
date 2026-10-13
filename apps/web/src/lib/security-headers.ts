/*
 * Security headers for every response the Worker returns (worker.ts), including pages that Workers Cache
 * stores and serves later. Static assets get theirs from public/_headers.
 *
 * No script-src/style-src: Next.js streams inline bootstrap scripts, so an enforcing script policy needs either
 * 'unsafe-inline' (no protection) or a per-request nonce, and a nonce cannot work with edge-cached HTML (every
 * visitor would get the same, published nonce). XSS is handled at the source instead: article HTML is
 * sanitized by the API (bleach), JSON-LD escapes "<", and other CMS text renders as text.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Strict-Transport-Security": "max-age=15552000",
};

export function withSecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return headers;
}
