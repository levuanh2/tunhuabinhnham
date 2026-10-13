import { describe, expect, it } from "vitest";
import { SKU_PATTERN, SLUG_PATTERN, skuFromSlug, toPrice, toSlug, withSuffix } from "./slug";

describe("toSlug", () => {
  it("turns Vietnamese names into URL-safe slugs", () => {
    expect(toSlug("Tủ nhựa 5 tầng màu trắng")).toBe("tu-nhua-5-tang-mau-trang");
    expect(toSlug("ĐỒ DÙNG cho Bé – Đẹp & Bền!!")).toBe("do-dung-cho-be-dep-ben");
    expect(toSlug("  Kệ   bếp (inox) 3 tầng, 60cm  ")).toBe("ke-bep-inox-3-tang-60cm");
    expect(toSlug("Tủ ngăn kéo Duy Tân – ưu đãi")).toBe("tu-ngan-keo-duy-tan-uu-dai");
  });

  it("returns an empty string instead of an invalid slug", () => {
    for (const name of ["", "   ", "!!!", "—", "🙂"]) expect(toSlug(name), name).toBe("");
  });

  it("always matches the API pattern and length", () => {
    for (const name of ["a", "-a-", "Tủ 1/2 cánh", "x".repeat(400), `${"ab ".repeat(140)}`]) {
      const slug = toSlug(name);
      expect(slug, name).toMatch(SLUG_PATTERN);
      expect(slug.length).toBeLessThanOrEqual(260);
    }
  });
});

describe("withSuffix", () => {
  it("adds -n and keeps the result valid and within the limit", () => {
    expect(withSuffix("tu-nhua", 2)).toBe("tu-nhua-2");
    const long = withSuffix(`${"a".repeat(255)}-bcd`, 12);
    expect(long.length).toBeLessThanOrEqual(260);
    expect(long).toMatch(SLUG_PATTERN);
    expect(long.endsWith("-12")).toBe(true);
  });
});

describe("skuFromSlug", () => {
  it("derives a valid product code from the slug", () => {
    expect(skuFromSlug("tu-nhua-5-tang")).toBe("TN-TU-NHUA-5-TANG");
    const long = skuFromSlug(toSlug("Tủ nhựa ".repeat(30)));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long).toMatch(SKU_PATTERN);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("toPrice", () => {
  it("accepts VND amounts with or without thousand separators", () => {
    for (const [input, expected] of [["1.250.000", "1250000"], ["1,250,000", "1250000"], ["1 250 000", "1250000"], ["1250000", "1250000"], ["  990000 ", "990000"], ["1250000.00", "1250000.00"], ["", ""]]) {
      expect(toPrice(input), input).toBe(expected);
    }
  });
  it("rejects text that is not a price", () => {
    for (const input of ["abc", "-5", "12,5", "1.2.3", "1250000đ", "1.25.000"]) expect(toPrice(input), input).toBeNull();
  });
});
