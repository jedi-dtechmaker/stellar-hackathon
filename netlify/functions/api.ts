import type { Context } from "@netlify/functions";
import serverless from "serverless-http";
import { createApp } from "../../apps/api/src/app.js";
import { triggerWorker } from "../lib/worker.js";

const handle = serverless(createApp({ onTelegramUpdate: triggerWorker }));
const prefix = "/.netlify/functions/api";

export default async function api(request: Request, context: Context) {
  // Accept both Netlify's rewritten URL and direct function invocations.
  const url = new URL(request.url);
  const path = url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) : url.pathname;
  const headers = Object.fromEntries(request.headers);
  // Use Netlify's verified client address for rate limiting, not caller headers.
  headers["x-forwarded-for"] = context.ip;
  const query: Record<string, string[]> = {};
  for (const [key, value] of url.searchParams) (query[key] ??= []).push(value);
  const result = await handle({
    path, httpMethod: request.method, headers,
    multiValueQueryStringParameters: query,
    body: request.body ? await request.text() : "",
    isBase64Encoded: false,
    requestContext: { identity: { sourceIp: context.ip } },
  }, {}) as { statusCode: number; headers: Record<string, string>; multiValueHeaders?: Record<string, string[]>; body: string; isBase64Encoded: boolean };
  const responseHeaders = new Headers(result.headers);
  for (const [key, values] of Object.entries(result.multiValueHeaders ?? {})) {
    for (const value of values) responseHeaders.append(key, value);
  }
  const body = request.method === "HEAD" || [204, 304].includes(result.statusCode) ? null
    : result.isBase64Encoded ? new Uint8Array(Buffer.from(result.body, "base64")) : result.body;
  return new Response(body, { status: result.statusCode, headers: responseHeaders });
}
