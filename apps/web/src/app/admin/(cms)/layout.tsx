import { connection } from "next/server";
import type { Metadata } from "next";
import { AdminShell } from "@/components/admin-shell";
import { getStoreName } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  return { title: { absolute: `Quản trị · ${await getStoreName()}` }, robots: { index: false, follow: false } };
}

export default async function CmsLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return <AdminShell storeName={await getStoreName()}>{children}</AdminShell>;
}
