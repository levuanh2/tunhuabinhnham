import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { publicApi } from "@/lib/api";

async function getSettings() { try { return await publicApi.settings(); } catch { return null; } }

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const name = settings?.store_name;
  // Omit keys instead of passing undefined: an explicit `title: undefined` drops the root default/template.
  return {
    ...(name && { title: { absolute: settings?.default_seo_title || name, template: `%s | ${name}` }, openGraph: { siteName: name } }),
    ...(settings?.default_seo_description && { description: settings.default_seo_description }),
    ...(settings?.favicon_url && { icons: { icon: settings.favicon_url } }),
  };
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return <><SiteHeader storeName={settings?.store_name} logoUrl={settings?.logo_url} /><main id="noi-dung">{children}</main><SiteFooter settings={settings} /></>;
}
