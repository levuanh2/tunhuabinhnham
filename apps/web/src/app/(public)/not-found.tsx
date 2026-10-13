import type { Metadata } from "next";
import { NotFoundContent } from "@/components/not-found-content";

export const metadata: Metadata = { title: "Không tìm thấy trang" };

// notFound() in a public page (unknown product or article): rendered inside the public layout.
export default function PublicNotFound() {
  return <NotFoundContent />;
}
