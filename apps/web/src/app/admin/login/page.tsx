"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const schema = z.object({ email: z.email("Email không hợp lệ"), password: z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự") });
type Values = z.infer<typeof schema>;
export default function LoginPage() {
  const router = useRouter(); const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });
  async function submit(values: Values) { try { const { error } = await createClient().auth.signInWithPassword(values); if (error) throw error; router.replace("/admin"); router.refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "Không thể đăng nhập"); } }
  return <main className="grid min-h-screen place-items-center bg-[#10213f] p-5"><div className="w-full max-w-md rounded-md bg-white p-8"><p className="display text-3xl">Tủ Nhựa Bình Nhâm</p><h1 className="mt-8 text-2xl font-bold">Đăng nhập quản trị</h1><p className="mt-2 muted">Dùng tài khoản đã được cấp quyền trong hệ thống.</p><form className="mt-7 grid gap-5" onSubmit={handleSubmit(submit)}><label className="label">Email<input className="field" type="email" autoComplete="email" {...register("email")} />{errors.email && <span className="error">{errors.email.message}</span>}</label><label className="label">Mật khẩu<input className="field" type="password" autoComplete="current-password" {...register("password")} />{errors.password && <span className="error">{errors.password.message}</span>}</label><button className="button" disabled={isSubmitting}>{isSubmitting ? "Đang đăng nhập…" : "Đăng nhập"}</button></form></div></main>;
}
