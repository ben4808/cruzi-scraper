import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { getProxyDispatcherForNextRequest } from './webshareProxy';

const DEFAULT_BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const RETRYABLE_STATUS_CODES = new Set([403, 429]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

function mergeHeaders(init?: RequestInit): Headers {
  const headers = new Headers(DEFAULT_BROWSER_HEADERS);
  if (init?.headers) {
    const extra = new Headers(init.headers);
    extra.forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function formatRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  dispatcher?: ProxyAgent,
): Promise<Response> {
  return (await undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    {
      ...init,
      ...(dispatcher ? { dispatcher } : {}),
    } as Parameters<typeof undiciFetch>[1],
  )) as Response;
}

export async function proxiedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    headers: mergeHeaders(init),
  };
  const requestUrl = formatRequestUrl(input);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const dispatcher = getProxyDispatcherForNextRequest();
    const response = await executeFetch(input, requestInit, dispatcher);

    if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES) {
      return response;
    }

    console.log(
      `proxiedFetch retry ${attempt}/${MAX_RETRIES} for HTTP ${response.status}: ${requestUrl}`,
    );
    await sleep(RETRY_BASE_DELAY_MS * attempt);
  }

  throw new Error(`proxiedFetch failed for ${requestUrl}`);
}
