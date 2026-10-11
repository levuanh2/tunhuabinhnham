const FALLBACK = "https://facebook.com";

/** Returns the normalised URL when it is an https Facebook/Messenger destination, otherwise null. */
export function allowedMessengerUrl(href?: string | null) {
  if (!href) return null;
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    if (url.protocol === "https:" && (host === "m.me" || host === "fb.me" || host === "facebook.com" || host.endsWith(".facebook.com") || host === "messenger.com" || host.endsWith(".messenger.com"))) return url.toString();
  } catch { /* invalid configuration */ }
  return null;
}

/** Like allowedMessengerUrl, but falls back to facebook.com so a contact link always works. */
export const safeMessengerUrl = (href?: string | null) => allowedMessengerUrl(href) ?? FALLBACK;
