import type { Metadata } from "next";
import { ShareDrop } from "@/components/share-drop";
export const metadata: Metadata = { title: "A drop for you", robots: { index: false, follow: false } };
export default async function DropPage({ params }: { params: Promise<{ code: string }> }) { const { code } = await params; return <ShareDrop code={code} />; }
