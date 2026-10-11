"use client";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";

export function ContactButton({ productId, href }: { productId: string; href: string }) {
  async function contact() {
    try { await fetch(`${process.env.NEXT_PUBLIC_API_URL}/contact-clicks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: productId, source: "product_detail" }) }); } catch { /* tracking must not block contact */ }
    let destination = "https://facebook.com";
    try {
      const url = new URL(href);
      const host = url.hostname.toLowerCase();
      if (url.protocol === "https:" && (host === "m.me" || host === "fb.me" || host === "facebook.com" || host.endsWith(".facebook.com") || host === "messenger.com" || host.endsWith(".messenger.com"))) destination = url.toString();
    } catch { /* invalid configuration uses the safe Facebook fallback */ }
    window.open(destination, "_blank", "noopener,noreferrer");
  }
  return <button className="button w-full sm:w-auto" onClick={contact}><MessageCircle size={19} /> Nhắn tin để mua</button>;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  return <button className="button secondary" onClick={async () => { await navigator.clipboard.writeText(value); toast.success(`Đã sao chép ${label}`); }}>Sao chép {label}</button>;
}
