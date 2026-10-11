import { describe, expect, it } from "vitest";
import { allowedMessengerUrl, safeMessengerUrl } from "./messenger";

describe("safeMessengerUrl", () => {
  it("keeps https Messenger and Facebook links", () => {
    expect(safeMessengerUrl("https://m.me/tunhua")).toBe("https://m.me/tunhua");
    expect(safeMessengerUrl("https://www.facebook.com/tunhua")).toBe("https://www.facebook.com/tunhua");
  });
  it("falls back for other hosts, http and junk", () => {
    expect(safeMessengerUrl("https://evil.example/m.me")).toBe("https://facebook.com");
    expect(safeMessengerUrl("http://m.me/x")).toBe("https://facebook.com");
    expect(safeMessengerUrl("javascript:alert(1)")).toBe("https://facebook.com");
    expect(safeMessengerUrl(null)).toBe("https://facebook.com");
  });
  it("reports invalid destinations as null for optional CTAs", () => {
    expect(allowedMessengerUrl("https://m.me/x")).toBe("https://m.me/x");
    expect(allowedMessengerUrl("ftp://m.me/x")).toBeNull();
    expect(allowedMessengerUrl("")).toBeNull();
  });
});
