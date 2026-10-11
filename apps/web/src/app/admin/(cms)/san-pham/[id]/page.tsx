"use client";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { adminFetch } from "@/lib/admin-api";
import { ProductForm } from "@/features/admin/product-form";
import type { Product } from "@/types/api";
export default function EditProductPage() { const { id } = useParams<{ id: string }>(); const { data, error } = useQuery({ queryKey: ["product", id], queryFn: () => adminFetch<Product>(`/products/${id}`) }); return <><h1 className="text-3xl font-bold">Sửa sản phẩm</h1>{error && <p className="error mt-5">{error.message}</p>}{data ? <ProductForm product={data}/> : <p className="mt-6">Đang tải…</p>}</>; }
