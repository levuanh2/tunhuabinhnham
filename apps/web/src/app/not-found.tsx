import type { Metadata } from "next";
import { NotFoundContent } from "@/components/not-found-content";
import PublicLayout from "./(public)/layout";

export const metadata: Metadata = { title: "Không tìm thấy trang" };

// Unknown URLs match no route group, so this renders under the root layout only: wrap it in the
// public layout so the visitor keeps the header, footer and a way back.
export default function NotFound() {
  return <PublicLayout><NotFoundContent /></PublicLayout>;
}
