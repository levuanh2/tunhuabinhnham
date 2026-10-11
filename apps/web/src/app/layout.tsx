import type { Metadata } from "next";
import { Be_Vietnam_Pro, Newsreader } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Be_Vietnam_Pro({ subsets: ["latin", "vietnamese"], variable: "--font-sans", weight: ["400", "500", "600", "700"] });
const serif = Newsreader({ subsets: ["latin", "vietnamese"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: { default: "Tủ Nhựa Bình Nhâm", template: "%s | Tủ Nhựa Bình Nhâm" },
  description: "Sản phẩm chọn lọc, thông tin minh bạch và tư vấn trực tiếp.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body className={`${sans.variable} ${serif.variable}`}><Providers>{children}</Providers><Toaster richColors position="top-right" /></body></html>;
}
