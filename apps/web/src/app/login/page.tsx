import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/ui";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export default function LoginPage() {
  return <><Header app /><main className="login-main"><Link className="breadcrumb" href="/"><ArrowLeft size={15} />Back to home</Link><SignInForm /></main><Footer /></>;
}
