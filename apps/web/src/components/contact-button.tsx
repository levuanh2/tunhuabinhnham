"use client";
import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { safeMessengerUrl } from "@/lib/messenger";

export function ContactButton({ productId, href }: { productId: string; href: string }) {
  async function contact() {
    try { await fetch(`${process.env.NEXT_PUBLIC_API_URL}/contact-clicks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: productId, source: "product_detail" }) }); } catch { /* tracking must not block contact */ }
    window.open(safeMessengerUrl(href), "_blank", "noopener,noreferrer");
  }
  return <button type="button" className="button w-full min-h-12 text-base" onClick={contact}><MessageCircle size={19} aria-hidden="true" /> Nhắn tin để mua</button>;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); toast.success(`Đã sao chép ${label}`); setTimeout(() => setCopied(false), 2000); }
    catch { toast.error(`Không thể sao chép ${label}. Hãy chọn và sao chép thủ công.`); }
  }
  return <button type="button" className="button secondary sm" onClick={copy}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}Sao chép {label}</button>;
}
