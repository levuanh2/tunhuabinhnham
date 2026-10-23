/* eslint-disable @next/next/no-html-link-for-pages -- plain anchors stand in for next/link (no router in jsdom) */
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/san-pham", search: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams(route.search) }));
import { NavigationFeedback } from "./navigation-feedback";

// next/link calls preventDefault on the clicks it turns into client navigations.
const handled = (event: React.MouseEvent) => event.preventDefault();
const page = () => <>
  <main id="noi-dung">
    <a href="/tin-tuc" onClick={handled}>client</a>
    <a href="/san-pham?category=tu-4-canh" onClick={handled}>tab</a>
    <a href="/san-pham" onClick={handled}>current</a>
    <a href="https://m.me/shop" onClick={handled}>other origin</a>
    <a href="/lien-he" target="_blank" onClick={handled}>new tab</a>
  </main>
  <NavigationFeedback />
</>;
const link = (name: string) => [...document.querySelectorAll("a")].find(a => a.textContent === name)!;
const busy = () => ({ link: document.querySelector("a[data-nav-pending]")?.textContent ?? null, main: document.getElementById("noi-dung")!.getAttribute("aria-busy"), bar: !!document.querySelector(".nav-progress") });

describe("NavigationFeedback", () => {
  beforeEach(() => { route.pathname = "/san-pham"; route.search = ""; window.history.replaceState(null, "", "/san-pham"); });

  it("shows the wait at once for a client navigation and ends it when the URL changes", () => {
    const view = render(page());
    fireEvent.click(link("tab"));
    expect(busy()).toEqual({ link: "tab", main: "true", bar: true });
    route.search = "category=tu-4-canh";
    view.rerender(page());
    expect(busy()).toEqual({ link: null, main: null, bar: false });
  });

  it("ignores clicks Next did not handle, modified clicks, other origins, new tabs and the current URL", () => {
    render(page());
    fireEvent.click(link("client"), { ctrlKey: true });
    fireEvent.click(link("client"), { button: 1 });
    fireEvent.click(link("current"));
    fireEvent.click(link("other origin"));
    fireEvent.click(link("new tab"));
    const plain = document.createElement("a"); plain.href = "#top"; document.body.append(plain); fireEvent.click(plain);
    expect(busy()).toEqual({ link: null, main: null, bar: false });
  });

  it("marks the link during the click itself, without waiting for a React render that a transition may replace", () => {
    render(page());
    let duringClick: ReturnType<typeof busy> | null = null;
    const after = () => { duringClick = busy(); };
    window.addEventListener("click", after); // registered after the component's listener: runs right after it
    link("tab").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    window.removeEventListener("click", after);
    expect(duringClick).toEqual({ link: "tab", main: "true", bar: true });
  });

  it("ends the wait on Back/Forward", () => {
    render(page());
    fireEvent.click(link("client"));
    expect(busy().bar).toBe(true);
    fireEvent.popState(window);
    expect(busy()).toEqual({ link: null, main: null, bar: false });
  });
});
