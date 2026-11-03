"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Links are not prefetched and the Worker sends a page only once it is fully rendered (it must know whether the
 * render degraded before choosing cache headers), so an uncached page can take seconds with nothing on screen.
 * This shows the wait at once: the clicked link dims, <main> is aria-busy, and a progress bar appears after
 * 150 ms (CSS delay: fast navigations never flash it). Only clicks that next/link handled (defaultPrevented)
 * count; everything else is a normal browser navigation with the browser's own indicator.
 * The marks are set on the DOM in the click handler, not through React state: Next renders the navigation as a
 * transition with the new URL already in its hooks, and state set beside it could be dropped before it commits
 * (WebKit). They are cleared when the new URL commits, on Back/Forward, or after 20 s. */
export function NavigationFeedback() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const current = search ? `${pathname}?${search}` : pathname;
  // Cleanup runs when the committed URL changes: the navigation has arrived.
  useEffect(() => clearPending, [current]);

  useEffect(() => {
    // window, not document: React's own listener (on the document root) has already run, so defaultPrevented is final.
    const onClick = (event: MouseEvent) => {
      if (!event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin) return;
      // The current page: no URL change will come to clear a wait, and it replaces any navigation in flight.
      if (url.pathname + url.search === location.pathname + location.search) clearPending();
      else markPending(link);
    };
    window.addEventListener("click", onClick);
    window.addEventListener("popstate", clearPending);
    return () => { window.removeEventListener("click", onClick); window.removeEventListener("popstate", clearPending); clearPending(); };
  }, []);

  return null;
}

// ponytail: a navigation Next abandons without changing the URL would leave the bar up; 20 s caps it.
let timeout: ReturnType<typeof setTimeout> | undefined;

function markPending(link: HTMLAnchorElement) {
  clearPending();
  link.setAttribute("data-nav-pending", "");
  document.getElementById("noi-dung")?.setAttribute("aria-busy", "true");
  const bar = document.createElement("div");
  bar.className = "nav-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.append(bar);
  timeout = setTimeout(clearPending, 20_000);
}

function clearPending() {
  clearTimeout(timeout);
  for (const element of document.querySelectorAll("[data-nav-pending]")) element.removeAttribute("data-nav-pending");
  document.getElementById("noi-dung")?.removeAttribute("aria-busy");
  for (const bar of document.querySelectorAll(".nav-progress")) bar.remove();
}
