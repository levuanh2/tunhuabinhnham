export type ProductStatus = "in_stock" | "out_of_stock" | "contact";
export type Product = {
  id: string; name: string; slug: string; sku: string; description?: string | null;
  price?: string | null; stock_status: ProductStatus; publish_status: "draft" | "published"; is_visible: boolean; is_featured: boolean; category_id?: string | null; category?: Category | null;
  images: ProductImage[]; attributes: Record<string, string>; published_at?: string | null;
};
export type ProductImage = { id: string; storage_key: string; url: string; alt_text?: string | null; sort_order: number; is_primary: boolean };
export type Category = { id: string; name: string; slug: string; description?: string | null; image_url?: string | null; is_visible?: boolean };
/** Admin list only: includes hidden categories and the number of (non-deleted) products using each one. */
export type AdminCategory = Category & { is_visible: boolean; sort_order: number; product_count: number };
export type PostImage = { id?: string; storage_key: string; url: string; alt_text?: string | null; sort_order: number };
export type Post = {
  id: string; title: string; slug: string; excerpt?: string | null;
  cover_image_url?: string | null; content_json?: Record<string, unknown>; content_html: string;
  publish_status: "draft" | "published"; published_at?: string | null;
  seo_title?: string | null; seo_description?: string | null; images: PostImage[];
  created_at?: string; updated_at?: string;
};
export type Banner = { id: string; title: string; subtitle?: string | null; image_url: string; cta_label?: string | null; cta_url?: string | null; is_active: boolean; sort_order: number };
export type SiteSettings = {
  id?: string; store_name: string; about_text: string; facebook_url: string;
  messenger_url?: string | null; hotline?: string | null; address?: string | null;
  logo_url?: string | null; favicon_url?: string | null; default_seo_title?: string | null;
  default_seo_description?: string | null; contact_tracking_enabled?: boolean;
};
export type MediaAsset = { id: string; url: string; storage_key: string; bucket: string };
export type Page<T> = { items: T[]; page: number; page_size: number; total: number; pages: number };
