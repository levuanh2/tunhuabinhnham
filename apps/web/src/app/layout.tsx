import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Newsreader } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Be_Vietnam_Pro({ subsets: ["latin", "vietnamese"], variable: "--font-be-vietnam", weight: ["400", "500", "600", "700"], display: "swap" });
const serif = Newsreader({ subsets: ["latin", "vietnamese"], variable: "--font-newsreader", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Tủ Nhựa Bình Nhâm", template: "%s | Tủ Nhựa Bình Nhâm" },
  description: "Tủ nhựa, tủ quần áo và đồ lưu trữ cho gia đình. Xem mẫu, hỏi giá và đặt mua qua Messenger.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#faf7f2" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi" className={`${sans.variable} ${serif.variable}`}><body><Providers>{children}</Providers><Toaster richColors position="top-right" toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} /></body></html>;
}
