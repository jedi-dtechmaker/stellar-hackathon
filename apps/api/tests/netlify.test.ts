import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getContext, type Context } from "@netlify/functions";
import { netlifyRequest } from "./netlify-client.js";
import { db, lockPool } from "../src/db.js";
import { authorizedWorker, triggerWorker, workerSecretHeader } from "../../../netlify/lib/worker.js";
import worker from "../../../netlify/functions/worker.js";

vi.mock("@netlify/functions", () => ({ getContext: vi.fn() }));
const deployContext = (context: string) => vi.mocked(getContext).mockReturnValue({ deploy: { context } } as Context);

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.mocked(getContext).mockReset(); });
afterAll(async () => { await db.$disconnect(); await lockPool.end(); });

describe("Netlify API adapter", () => {
  it.each(["/api/dashboard", "/.netlify/functions/api/api/dashboard"])("preserves authentication at %s", async path => {
    expect((await netlifyRequest(path)).status).toBe(401);
  });
  it("preserves email input validation and security headers", async () => {
    const response = await netlifyRequest("/api/auth/email/request", "POST", { email: "invalid-email" });
    expect(response.status).toBe(400);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
  it("rejects a forged session through the deployed function path", async () => {
    const response = await netlifyRequest("/.netlify/functions/api/api/me", "GET", undefined, { authorization: "Bearer forged" });
    expect(response.status).toBe(401);
  });
  it("does not acknowledge an unauthenticated Telegram webhook", async () => {
    expect((await netlifyRequest("/api/webhooks/telegram", "POST", { update_id: 1 })).status).toBe(403);
  });
});

describe("Netlify worker access", () => {
  const secret = "a-separate-random-worker-secret-at-least-32-characters";
  const request = (value = secret, method = "POST") => new Request("https://stellardrop.example/.netlify/functions/worker", { method, headers: { [workerSecretHeader]: value } });
  it("requires the worker secret and a POST in the production context", async () => {
    vi.stubEnv("WORKER_SECRET", secret); deployContext("production");
    expect(authorizedWorker(request())).toBe(true);
    expect(authorizedWorker(request("wrong"))).toBe(false);
    expect(authorizedWorker(request(secret, "GET"))).toBe(false);
    expect((await worker(request("wrong"))).status).toBe(403);
  });
  it("rejects preview invocations even with the production secret", async () => {
    vi.stubEnv("WORKER_SECRET", secret); deployContext("deploy-preview");
    expect((await worker(request())).status).toBe(403);
  });
  it("invokes the worker on the configured site without following redirects", async () => {
    vi.stubEnv("WORKER_SECRET", secret); deployContext("production"); vi.stubEnv("WEB_ORIGIN", "https://stellardrop.example");
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 })); vi.stubGlobal("fetch", fetch);
    await triggerWorker();
    expect(fetch).toHaveBeenCalledWith(new URL("https://stellardrop.example/.netlify/functions/worker"), expect.objectContaining({ method: "POST", redirect: "error", headers: { [workerSecretHeader]: secret } }));
  });
  it("does not invoke a production worker from a preview", async () => {
    deployContext("deploy-preview");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await triggerWorker(); expect(fetch).not.toHaveBeenCalled();
  });
  it("reports a trigger failure so scheduled retries can recover", async () => {
    vi.stubEnv("WORKER_SECRET", secret); deployContext("production"); vi.stubEnv("WEB_ORIGIN", "https://stellardrop.example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(triggerWorker()).rejects.toThrow("could not be invoked");
  });
  it("works without the build-only CONTEXT environment variable", async () => {
    vi.stubEnv("CONTEXT", undefined); vi.stubEnv("WORKER_SECRET", secret); deployContext("production");
    expect(authorizedWorker(request())).toBe(true);
  });
  it("does not trust a production environment variable in a preview", async () => {
    vi.stubEnv("CONTEXT", "production"); vi.stubEnv("WORKER_SECRET", secret); deployContext("deploy-preview");
    expect(authorizedWorker(request())).toBe(false);
  });
  it("rejects invocations without a Netlify request context", async () => {
    vi.stubEnv("CONTEXT", "production"); vi.stubEnv("WORKER_SECRET", secret);
    vi.mocked(getContext).mockImplementation(() => { throw new Error("No request context"); });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(authorizedWorker(request())).toBe(false);
    await triggerWorker(); expect(fetch).not.toHaveBeenCalled();
  });
});
