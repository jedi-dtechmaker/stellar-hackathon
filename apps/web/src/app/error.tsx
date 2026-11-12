"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="connect-state"><h1>A small interruption.</h1><p>Something went wrong opening this page. Give it another try.</p><button className="button button-dark" onClick={reset}>Try again ↗</button></main>; }
