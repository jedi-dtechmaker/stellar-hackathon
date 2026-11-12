import type { Context } from "@netlify/functions";
import api from "../../../netlify/functions/api.js";

export async function netlifyRequest(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`https://stellardrop.example${path}`, {
    method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await api(request, { ip: "127.0.0.1" } as Context);
  const text = await response.text();
  return { status: response.status, headers: Object.fromEntries(response.headers), body: text ? JSON.parse(text) as Record<string, any> : {} };
}
