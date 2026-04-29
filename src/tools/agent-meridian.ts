import { config } from "../core/config/config.js";

export function getAgentMeridianBase(): string {
  return String(config.api?.url || "https://api.agent-meridian.xyz/api").replace(/\/+$/, "");
}

export function getAgentMeridianHeaders({ json = false }: { json?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (config.api?.publicApiKey) headers["x-api-key"] = config.api.publicApiKey;
  return headers;
}

export function getAgentIdForRequests(): string {
  return config.hiveMind?.agentId || "agent-local";
}

interface RetryConfig {
  retry?: boolean;
  maxElapsedMs?: number;
  maxAttempts?: number;
  perAttemptTimeoutMs?: number;
}

interface FetchOptions extends RetryConfig {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(error: any, attempt: number): number {
  const retryAfter = Number(error?.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 10_000);
  }
  return Math.min(500 * 2 ** attempt, 5_000);
}

async function fetchWithTimeout(url: string, options: FetchOptions, timeoutMs: number): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal;
  const abortFromParent = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abortFromParent);
  }
}

interface AgentMeridianResponse {
  status: number;
  payload: any;
  error?: string;
  retryAfter?: string;
}

async function agentMeridianJsonOnce(pathname: string, options: FetchOptions = {}): Promise<AgentMeridianResponse> {
  const url = `${getAgentMeridianBase()}${pathname}`;
  const res = await fetchWithTimeout(url, options, options.perAttemptTimeoutMs || 0);
  const text = await res.text().catch(() => "");
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    const error = new Error(typeof payload?.error === "string" ? payload.error : `${pathname} ${res.status}`);
    (error as any).status = res.status;
    (error as any).payload = payload;
    (error as any).retryAfter = res.headers.get("retry-after");
    throw error;
  }
  return {
    status: res.status,
    payload,
  };
}

export async function agentMeridianJson(pathname: string, options: FetchOptions = {}): Promise<any> {
  const { retry, ...fetchOptions } = options;
  if (!retry) {
    return agentMeridianJsonOnce(pathname, fetchOptions);
  }

  const maxElapsedMs = Number(options.maxElapsedMs || 30_000);
  const maxAttempts = Number(options.maxAttempts || 10);
  const startedAt = Date.now();
  let attempt = 0;
  let lastError: any = null;

  while (Date.now() - startedAt < maxElapsedMs && attempt < maxAttempts) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = Math.max(1, maxElapsedMs - elapsedMs);

    try {
      return await agentMeridianJsonOnce(
        pathname,
        {
          ...fetchOptions,
          perAttemptTimeoutMs: Math.min(Number(options.perAttemptTimeoutMs || 10_000), remainingMs),
        }
      );
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.status || 0);
      if (!isRetryableStatus(status) || attempt >= maxAttempts - 1) {
        throw error;
      }
      const waitMs = Math.min(retryDelayMs(error, attempt), Math.max(0, remainingMs - 1));
      if (waitMs <= 0) break;
      await new Promise((r) => setTimeout(r, waitMs));
      attempt += 1;
    }
  }

  throw lastError || new Error(`${pathname} retry budget exhausted`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
