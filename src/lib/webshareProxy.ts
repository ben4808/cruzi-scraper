import { fetch as undiciFetch, ProxyAgent } from 'undici';

const WEBSHARE_API_BASE = 'https://proxy.webshare.io/api/v2';

export interface WebshareProxy {
  host: string;
  port: string;
  username: string;
  password: string;
}

interface WebshareProxyConfig {
  proxy_list_download_token?: string;
}

let proxies: WebshareProxy[] = [];
let proxyIndex = 0;
let configured = false;
let proxyRoutingEnabled = false;

function parseProxyLine(line: string): WebshareProxy | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const parts = trimmed.split(':');
  if (parts.length < 4) {
    return null;
  }

  const [host, port, username, ...passwordParts] = parts;
  const password = passwordParts.join(':');
  if (!host || !port || !username || !password) {
    return null;
  }

  return { host, port, username, password };
}

function parseProxyList(text: string): WebshareProxy[] {
  const parsed = text
    .split(/\r?\n/)
    .map(parseProxyLine)
    .filter((proxy): proxy is WebshareProxy => proxy !== null);

  if (parsed.length === 0) {
    throw new Error('Webshare proxy list did not contain any valid proxies.');
  }

  return parsed;
}

function webshareAuthHeaders(apiToken: string): Record<string, string> {
  return { Authorization: `Token ${apiToken}` };
}

async function readErrorBody(response: Awaited<ReturnType<typeof undiciFetch>>): Promise<string> {
  const body = await response.text();
  return body.length > 500 ? `${body.slice(0, 500)}...` : body;
}

async function fetchProxyListDownloadToken(apiToken: string): Promise<string> {
  const response = await undiciFetch(`${WEBSHARE_API_BASE}/proxy/config/`, {
    headers: webshareAuthHeaders(apiToken),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Webshare proxy config (${response.status}): ${await readErrorBody(response)}`,
    );
  }

  const config = (await response.json()) as WebshareProxyConfig;
  const downloadToken = config.proxy_list_download_token?.trim();
  if (!downloadToken) {
    throw new Error('Webshare proxy config response missing proxy_list_download_token.');
  }

  return downloadToken;
}

function buildProxyListDownloadUrl(downloadToken: string, planId?: string): string {
  const base = `${WEBSHARE_API_BASE}/proxy/list/download/${downloadToken}/-/any/username/direct/-/`;
  return planId ? `${base}?plan_id=${encodeURIComponent(planId)}` : base;
}

async function downloadProxyListText(downloadUrl: string): Promise<string> {
  const response = await undiciFetch(downloadUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download Webshare proxy list (${response.status}): ${await readErrorBody(response)}`,
    );
  }

  return response.text();
}

async function loadProxiesFromApi(apiToken: string, planId?: string): Promise<WebshareProxy[]> {
  const downloadToken = await fetchProxyListDownloadToken(apiToken);
  const downloadUrl = buildProxyListDownloadUrl(downloadToken, planId);
  const proxyListText = await downloadProxyListText(downloadUrl);
  return parseProxyList(proxyListText);
}

async function loadProxiesFromInlineConfig(proxyListConfig: string): Promise<WebshareProxy[]> {
  if (/^https?:\/\//i.test(proxyListConfig)) {
    const proxyListText = await downloadProxyListText(proxyListConfig);
    return parseProxyList(proxyListText);
  }

  return parseProxyList(proxyListConfig);
}

async function loadProxies(): Promise<WebshareProxy[]> {
  const apiToken = process.env.WEBSHARE_API_TOKEN?.trim();
  if (apiToken) {
    const planId = process.env.WEBSHARE_PLAN_ID?.trim();
    return loadProxiesFromApi(apiToken, planId || undefined);
  }

  const proxyListConfig = process.env.WEBSHARE_PROXY_LIST?.trim();
  if (!proxyListConfig) {
    throw new Error(
      'WEBSHARE_API_TOKEN environment variable is not set. '
      + 'Create an API key at https://proxy.webshare.io/ and add it to .env.dev / .env.local.',
    );
  }

  try {
    return await loadProxiesFromInlineConfig(proxyListConfig);
  } catch (error) {
    if (
      proxyListConfig.startsWith('http')
      && error instanceof Error
      && error.message.includes('(400)')
    ) {
      throw new Error(
        `${error.message} The download token in WEBSHARE_PROXY_LIST has likely expired. `
        + 'Set WEBSHARE_API_TOKEN instead so a fresh token is fetched on each run.',
      );
    }
    throw error;
  }
}

function nextProxy(): WebshareProxy {
  const proxy = proxies[proxyIndex % proxies.length];
  proxyIndex += 1;
  return proxy;
}

function proxyToUrl(proxy: WebshareProxy): string {
  const username = encodeURIComponent(proxy.username);
  const password = encodeURIComponent(proxy.password);
  return `http://${username}:${password}@${proxy.host}:${proxy.port}`;
}

export function getProxyDispatcherForNextRequest(): ProxyAgent | undefined {
  if (!proxyRoutingEnabled || proxies.length === 0) {
    return undefined;
  }

  return new ProxyAgent(proxyToUrl(nextProxy()));
}

export async function configureWebshareProxy(): Promise<void> {
  if (configured) {
    return;
  }

  if (process.env.PUZ_LOCATION !== 'S3') {
    proxyRoutingEnabled = false;
    configured = true;
    console.log('Skipping Webshare proxy routing; PUZ_LOCATION is not set to S3.');
    return;
  }

  proxies = await loadProxies();
  proxyRoutingEnabled = true;
  configured = true;
  console.log(`Configured Webshare proxy routing with ${proxies.length} proxies.`);
}
