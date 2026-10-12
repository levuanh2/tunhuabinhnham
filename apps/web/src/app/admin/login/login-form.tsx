"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

const schema = z.object({ email: z.email("Email không hợp lệ"), password: z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự") });
type Values = z.infer<typeof schema>;
export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });
  async function submit(values: Values) {
    setFormError(null);
    try { const { error } = await createClient().auth.signInWithPassword(values); if (error) throw error; router.replace("/admin"); router.refresh(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      setFormError(/invalid login credentials/i.test(message) ? "Email hoặc mật khẩu không đúng." : message || "Không thể đăng nhập");
    }
  }
  return <>
    {formError && <p role="alert" className="alert mt-5">{formError}</p>}
    <form className="mt-6 grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
      <label className="label">Email<input className="field" type="email" autoComplete="email" aria-invalid={errors.email ? true : undefined} {...register("email")} />{errors.email && <span className="error">{errors.email.message}</span>}</label>
      <label className="label">Mật khẩu<input className="field" type="password" autoComplete="current-password" aria-invalid={errors.password ? true : undefined} {...register("password")} />{errors.password && <span className="error">{errors.password.message}</span>}</label>
      <button className="button mt-2 w-full" disabled={isSubmitting}>{isSubmitting ? "Đang đăng nhập…" : "Đăng nhập"}</button>
    </form>
  </>;
}
