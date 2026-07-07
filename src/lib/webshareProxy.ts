import * as dotenv from 'dotenv';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

dotenv.config();

export interface WebshareProxy {
  host: string;
  port: string;
  username: string;
  password: string;
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
    throw new Error('WEBSHARE_PROXY_LIST did not contain any valid proxies.');
  }

  return parsed;
}

async function loadProxyListText(): Promise<string> {
  const proxyListConfig = process.env.WEBSHARE_PROXY_LIST?.trim();
  if (!proxyListConfig) {
    throw new Error('WEBSHARE_PROXY_LIST environment variable is not set.');
  }

  if (/^https?:\/\//i.test(proxyListConfig)) {
    const response = await undiciFetch(proxyListConfig);
    if (!response.ok) {
      throw new Error(`Failed to download Webshare proxy list (${response.status}).`);
    }
    return response.text();
  }

  return proxyListConfig;
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

  const proxyListText = await loadProxyListText();
  proxies = parseProxyList(proxyListText);
  proxyRoutingEnabled = true;

  configured = true;
  console.log(`Configured Webshare proxy routing with ${proxies.length} proxies.`);
}
