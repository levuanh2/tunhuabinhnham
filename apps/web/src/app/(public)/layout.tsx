import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { publicApi } from "@/lib/api";

async function getSettings() { try { return await publicApi.settings(); } catch { return null; } }

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: settings?.default_seo_title ?? undefined,
    description: settings?.default_seo_description ?? undefined,
    icons: settings?.favicon_url ? { icon: settings.favicon_url } : undefined,
  };
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return <><SiteHeader storeName={settings?.store_name} logoUrl={settings?.logo_url} /><main id="noi-dung">{children}</main><SiteFooter settings={settings} /></>;
}
