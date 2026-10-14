import type { Page } from "@playwright/test";

/**
 * Fill admin forms only after React has hydrated them: text typed into a server-rendered controlled
 * input before hydration is reset to the initial state (seen in desktop WebKit as an empty title,
 * the browser then blocking Save on the required field).
 */
export async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await waitForHydration(page);
}

/** React attaches __reactFiber* keys to DOM nodes only when it has hydrated them. */
export async function waitForHydration(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => {
    const el = document.querySelector("main input, main textarea, main select, main button");
    return !el || Object.keys(el).some(key => key.startsWith("__reactFiber"));
  });
}
