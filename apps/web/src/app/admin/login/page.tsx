import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { getStoreName } from "@/lib/brand";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: { absolute: `Đăng nhập quản trị · ${await getStoreName()}` }, robots: { index: false, follow: false } };
}

export default async function LoginPage() {
  await connection();
  return <main className="grid min-h-screen place-items-center bg-bg px-4 py-10">
    <div className="w-full max-w-[400px]">
      <Link href="/" className="display block text-center text-2xl">{await getStoreName()}</Link>
      <div className="panel mt-6 p-6 sm:p-8">
        <h1 className="text-xl font-semibold">Đăng nhập quản trị</h1>
        <p className="mt-1 text-sm text-ink-soft">Dùng tài khoản đã được cấp quyền quản trị.</p>
        <LoginForm />
      </div>
      <p className="mt-6 text-center text-sm"><Link href="/" className="text-ink-soft hover:text-ink">Về trang chủ</Link></p>
    </div>
  </main>;
}
