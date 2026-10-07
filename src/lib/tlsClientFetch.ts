import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';
import { ClientIdentifier, initTLS, Session } from 'node-tls-client';
import { getProxyUrlForNextRequest } from './webshareProxy';

const CHROME_HEADERS: OutgoingHttpHeaders = {
  'cache-control': 'max-age=0',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-user': '?1',
  'sec-fetch-dest': 'document',
  'accept-encoding': 'gzip, deflate, br',
  'accept-language': 'en-US,en;q=0.9',
};

const HEADER_ORDER = [
  'cache-control',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'upgrade-insecure-requests',
  'user-agent',
  'accept',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-user',
  'sec-fetch-dest',
  'accept-encoding',
  'accept-language',
];

let tlsInit: Promise<void> | undefined;

async function ensureTlsInitialized(): Promise<void> {
  if (!tlsInit) {
    tlsInit = initTLS().catch((error) => {
      tlsInit = undefined;
      throw error;
    });
  }
  await tlsInit;
}

function mergeOutgoingHeaders(extra?: Headers): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...CHROME_HEADERS };
  extra?.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function toFetchResponse(status: number, body: string, headers: IncomingHttpHeaders): Response {
  const fetchHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        fetchHeaders.append(key, item);
      }
    } else {
      fetchHeaders.set(key, value);
    }
  }

  return new Response(body, {
    status,
    headers: fetchHeaders,
  });
}

/**
 * Fetch using a Chrome TLS fingerprint. Used for xwordinfo.com (NYT),
 * which rejects Node/undici JA3 fingerprints.
 */
export async function tlsClientFetch(
  url: string,
  init?: RequestInit,
  sourceId?: string,
): Promise<Response> {
  await ensureTlsInitialized();

  const headers = mergeOutgoingHeaders(init?.headers ? new Headers(init.headers) : undefined);
  const session = new Session({
    clientIdentifier: ClientIdentifier.chrome_131,
    timeout: 30_000,
    headers,
    headerOrder: HEADER_ORDER as unknown as OutgoingHttpHeaders[],
  });

  try {
    const response = await session.get(url, {
      headers,
      headerOrder: HEADER_ORDER as unknown as OutgoingHttpHeaders[],
      followRedirects: true,
      proxy: getProxyUrlForNextRequest(sourceId),
    });

    return toFetchResponse(response.status, await response.text(), response.headers);
  } finally {
    await session.close().catch(() => undefined);
  }
}
