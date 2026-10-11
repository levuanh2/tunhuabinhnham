"use client";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { adminFetch } from "@/lib/admin-api";
import { AdminPageHeader } from "@/components/admin-shell";
import { ProductForm } from "@/features/admin/product-form";
import type { Product } from "@/types/api";
export default function EditProductPage() { const { id } = useParams<{ id: string }>(); const { data, error } = useQuery({ queryKey: ["product", id], queryFn: () => adminFetch<Product>(`/products/${id}`) }); return <><AdminPageHeader title="Sửa sản phẩm" description={data?.name} />{error ? <p role="alert" className="alert">{error.message}</p> : data ? <ProductForm product={data}/> : <p className="text-ink-soft">Đang tải sản phẩm…</p>}</>; }
