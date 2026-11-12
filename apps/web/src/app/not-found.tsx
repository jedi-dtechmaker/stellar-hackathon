import Link from "next/link";
import { Header } from "@/components/header";
export default function NotFound() { return <><Header /><main className="connect-state"><div className="eyebrow">404 · A LITTLE OFF COURSE</div><h1>This drop took a detour.</h1><p>The page you’re looking for isn’t here.</p><Link className="button button-dark" href="/">Back to home ↗</Link></main></>; }
