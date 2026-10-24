import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/types/api";

const api = vi.hoisted(() => ({ product: vi.fn(), settings: vi.fn(), products: vi.fn() }));
vi.mock("@/lib/api", () => ({ publicApi: api }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), permanentRedirect: vi.fn(), usePathname: () => "/", useRouter: () => ({}) }));
import { ProductCard } from "@/components/product-card";
import ProductDetailPage from "./page";

const make = (id: string, slug: string): Product => ({ id, name: slug, slug, sku: id, price: null, stock_status: "in_stock", publish_status: "published", is_visible: true, is_featured: false, images: [], attributes: {}, category: { id: "c1", name: "Tủ quần áo", slug: "tu-quan-ao" } as Product["category"] });
const cards = (node: ReactNode): string[] => {
  if (Array.isArray(node)) return node.flatMap(cards);
  if (!isValidElement(node)) return [];
  if (node.type === ProductCard) return [(node.props as { product: Product }).product.slug];
  return cards((node.props as { children?: ReactNode }).children);
};

describe("product detail page data", () => {
  it("gets the related products in the product's own response and renders them on the server", async () => {
    let resolveProduct!: (p: Product) => void;
    api.product.mockReturnValue(new Promise<Product>(r => { resolveProduct = r; }));
    api.settings.mockResolvedValue(null);
    const page = ProductDetailPage({ params: Promise.resolve({ slug: "tu-a" }), searchParams: Promise.resolve({}) });
    await vi.waitFor(() => expect(api.product).toHaveBeenCalledWith("tu-a"));
    expect(api.settings).toHaveBeenCalled(); // in parallel with the product
    resolveProduct({ ...make("p1", "tu-a"), related: [make("p2", "tu-b")] } as Product);
    // SEO: the related links stay in the server-rendered page
    expect(cards(await page)).toEqual(["tu-b"]);
    // fail-before: a second request (`category=` after the product)
    expect(api.products).not.toHaveBeenCalled();
  });

  it("an API without `related` (old backend) renders the product without the section", async () => {
    api.product.mockResolvedValue(make("p1", "tu-a"));
    api.settings.mockResolvedValue(null);
    const page = await ProductDetailPage({ params: Promise.resolve({ slug: "tu-a" }), searchParams: Promise.resolve({}) });
    expect(cards(page)).toEqual([]);
  });
});
