// Indexes the per-NFT wallets of a collection using the OpenSea API
// (with a Blockscout fallback for balances) and writes site/data/wallets.json.
// SECURITY: the API key is read from env and only ever sent as a request header.
// It is never logged, and request headers are never printed.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseListItem, parseSingleNft, parseHeldNft, parseOpenSeaToken,
  parseBlockscoutEth, parseBlockscoutTokens, pickArray, pick, isObj, shortJson,
} from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = (k, d) => (process.env[k] && process.env[k].trim() !== '' ? process.env[k].trim() : d);

const CONTRACT = env('CONTRACT', '0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0').toLowerCase();
const CHAIN = env('OPENSEA_CHAIN', 'robinhood');
const CHAIN_ID = Number(env('CHAIN_ID', '4663'));
const WALLET_TRAIT = env('WALLET_TRAIT', '');
const API_KEY = env('OPENSEA_API_KEY', '');
const OS = 'https://api.opensea.io';
const BS = env('BLOCKSCOUT_URL', 'https://robinhoodchain.blockscout.com').replace(/\/$/, '');
const CONCURRENCY = Math.min(3, Math.max(1, Number(env('CONCURRENCY', '3'))));
const RECHECK = Number(env('RECHECK_PER_RUN', '60'));
const MAX_RUNTIME_MS = Number(env('MAX_RUNTIME_MIN', '90')) * 60_000;
const MAX_PAGES = Number(env('MAX_PAGES', '200'));
const CACHE_FILE = path.join(ROOT, env('CACHE_FILE', '.cache/wallet-map.json'));
const OUT_FILE = path.join(ROOT, env('OUT_FILE', 'site/data/wallets.json'));
const TRAITS_ONLY = /^(1|true|yes)$/i.test(env('TRAITS_ONLY', ''));
const START = Date.now();

if (!API_KEY) { console.error('OPENSEA_API_KEY is not set'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeLeft = () => MAX_RUNTIME_MS - (Date.now() - START);

// ---- HTTP: spaced requests, retry/backoff on 429/5xx ----
const diagLogged = new Set();
let nextSlot = 0;
let retryCount = 0;
let gapMs = Number(env('MIN_GAP_MS', '400'));
const BASE_GAP_MS = gapMs;
async function gate() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gapMs;
  if (at > now) await sleep(at - now);
}

class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} for ${url}`); this.status = status; }
}

async function getJson(url, { opensea = false, retries = 6 } = {}) {
  const headers = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; sb-holdings-indexer/1.0; +https://github.com/executiveA-us/Sb-holdings)' };
  if (opensea) headers['x-api-key'] = API_KEY;
  const safeUrl = url.replace(/^https:\/\/[^/]+/, '');
  for (let attempt = 0; ; attempt++) {
    if (opensea) await gate();
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      if (attempt >= retries) throw new Error(`network error for ${safeUrl}: ${e.name}`);
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) {
      if (opensea && gapMs > BASE_GAP_MS) gapMs = Math.max(BASE_GAP_MS, gapMs * 0.98); // slowly speed back up
      return res.json();
    }
    if (opensea && res.status === 429) gapMs = Math.min(2000, gapMs * 1.25); // adaptive slow-down
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      const wait = Math.max(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60_000) : 0, backoff(attempt));
      retryCount++;
      if (retryCount <= 5 || retryCount % 25 === 0) {
        console.warn(`  [retry #${retryCount}] HTTP ${res.status} on ${safeUrl.split('?')[0]} — waiting ${Math.round(wait / 1000)}s, gap now ${Math.round(gapMs)}ms (attempt ${attempt + 1}/${retries})`);
      }
      await sleep(wait);
      continue;
    }
    if (!opensea && !diagLogged.has(res.status)) {
      diagLogged.add(res.status);
      const snippet = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      console.warn(`  [diag] non-OpenSea HTTP ${res.status} for ${safeUrl.split('?')[0]} — body: ${snippet}`);
    }
    throw new HttpError(res.status, safeUrl);
  }
}
const backoff = (n) => Math.min(30_000, 1000 * 2 ** n) + Math.random() * 500;

// ---- first-run diagnostics: top-level keys + one sample item per endpoint ----
const sampled = new Set();
function sample(label, body, itemKeys = []) {
  if (sampled.has(label)) return;
  sampled.add(label);
  const keys = isObj(body) ? Object.keys(body) : Array.isArray(body) ? '(array)' : typeof body;
  console.log(`\n[sample] ${label}\n  top-level keys: ${Array.isArray(keys) ? keys.join(', ') : keys}`);
  const arr = pickArray(body, ...itemKeys);
  const item = arr.length ? arr[0] : body;
  console.log(`  sample item: ${shortJson(item)}\n`);
}

async function pool(items, worker, size = CONCURRENCY) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

// ---- cache ----
async function loadCache() {
  try {
    const c = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    if (c.contract === CONTRACT && c.trait === WALLET_TRAIT && isObj(c.tokens)) return c;
  } catch { /* none */ }
  return { contract: CONTRACT, trait: WALLET_TRAIT, tokens: {} };
}
async function saveCache(cache) {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache));
}

// ---- OpenSea: collection listing ----
async function listCollectionNfts() {
  const out = [];
  let next = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${OS}/api/v2/chain/${CHAIN}/contract/${CONTRACT}/nfts?limit=200${next ? `&next=${encodeURIComponent(next)}` : ''}`;
    const body = await getJson(url, { opensea: true });
    sample('list collection NFTs', body, ['nfts']);
    for (const it of pickArray(body, 'nfts')) {
      const p = parseListItem(it);
      if (p) out.push({ ...p, collection: isObj(it) ? pick(it, 'collection') : null });
    }
    next = body?.next || '';
    if (!next) break;
  }
  return out;
}

async function fetchSingle(tokenId) {
  const url = `${OS}/api/v2/chain/${CHAIN}/contract/${CONTRACT}/nfts/${encodeURIComponent(tokenId)}`;
  const body = await getJson(url, { opensea: true });
  sample('single NFT', body, ['nft']);
  return parseSingleNft(body, WALLET_TRAIT);
}

// ---- per-wallet scanning ----
const RPC_URL = env('RPC_URL', '');
async function rpcBalance(wallet) {
  if (!RPC_URL) return null;
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet, 'latest'] }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json();
  return j?.result ? Number(BigInt(j.result)) / 1e18 : null;
}

let tokensEndpointFailures = 0;

async function paged(urlBase, cursorParam, label, itemKeys, parse) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${urlBase}${urlBase.includes('?') ? '&' : '?'}limit=200${cursor ? `&${cursorParam}=${encodeURIComponent(cursor)}` : ''}`;
    const body = await getJson(url, { opensea: true });
    sample(label, body, itemKeys);
    for (const it of pickArray(body, ...itemKeys)) { const p = parse(it); if (p) out.push(p); }
    cursor = body?.next || '';
    if (!cursor) break;
  }
  return out;
}

async function blockscoutTokens(wallet) {
  const body = await getJson(`${BS}/api/v2/addresses/${wallet}/token-balances`);
  sample('blockscout token-balances', body, ['items']);
  return parseBlockscoutTokens(body);
}

async function scanWallet(wallet) {
  const r = { ethBalance: 0, tokens: [], nfts: [], source: 'none', errors: [] };

  // NFTs held
  try {
    r.nfts = await paged(`${OS}/api/v2/chain/${CHAIN}/account/${wallet}/nfts`, 'next', 'account NFTs', ['nfts'], parseHeldNft);
  } catch (e) { r.errors.push(`nfts: ${e.message}`); }

  // Native ETH (Blockscout) — also yields an ETH/USD rate
  let ethRate = null;
  try {
    const body = await getJson(`${BS}/api/v2/addresses/${wallet}`);
    sample('blockscout address', body);
    const p = parseBlockscoutEth(body);
    r.ethBalance = p.eth; ethRate = p.rate;
  } catch (e) {
    // Unknown/never-used addresses 404 on Blockscout: treat as empty.
    if (e.status === 404) r.ethBalance = 0;
    else {
      const rpc = await rpcBalance(wallet).catch(() => null);
      if (rpc !== null) r.ethBalance = rpc; else r.errors.push(`eth: ${e.message}`);
      r.ethFromBlockscoutFailed = rpc === null;
    }
  }

  // Token balances: OpenSea first, Blockscout fallback
  let done = false;
  if (tokensEndpointFailures < 5) {
    try {
      const toks = await paged(`${OS}/api/v2/account/${wallet}/tokens?chains=${CHAIN}`, 'cursor', 'account tokens', ['token_balances', 'tokens', 'results'], parseOpenSeaToken);
      r.tokens = toks.map(({ _usdUnit, ...t }) => ({ ...t, usd: t.usd ?? (_usdUnit !== null ? _usdUnit * t.quantity : null) }));
      r.source = 'opensea';
      tokensEndpointFailures = 0;
      done = true;
    } catch (e) {
      tokensEndpointFailures++;
      r.errors.push(`opensea tokens: ${e.message}`);
      if (tokensEndpointFailures === 5) console.warn('OpenSea tokens endpoint failed 5 times in a row; using Blockscout only from now on.');
    }
  }
  if (!done) {
    try {
      r.tokens = await blockscoutTokens(wallet);
      r.source = 'blockscout';
      r.errors = r.errors.filter((m) => !m.startsWith('opensea tokens')); // fallback worked
    } catch (e) {
      if (e.status === 404) { r.source = 'blockscout'; r.tokens = []; }
      else r.errors.push(`blockscout tokens: ${e.message}`);
    }
  }

  // If Blockscout/RPC failed, OpenSea may list native ETH among the tokens: use it for the balance.
  if (r.ethFromBlockscoutFailed) {
    const i = r.tokens.findIndex((t) => (!t.address || /^0x0{40}$/i.test(t.address)) && /^eth$/i.test(t.symbol || ''));
    if (i >= 0) {
      const [native] = r.tokens.splice(i, 1);
      r.ethBalance = native.quantity; ethRate = native.usd !== null && native.quantity ? native.usd / native.quantity : null;
      r.errors = r.errors.filter((m) => !m.startsWith('eth:'));
    }
  }
  delete r.ethFromBlockscoutFailed;

  r.ethUsd = ethRate !== null ? r.ethBalance * ethRate : null;
  return r;
}

// ---- main ----
async function main() {
  console.log(`Indexing ${CONTRACT} on ${CHAIN} (chain ${CHAIN_ID})${WALLET_TRAIT ? `, wallet trait "${WALLET_TRAIT}"` : ', auto-detecting wallet trait'}`);
  const cache = await loadCache();
  const listed = await listCollectionNfts();
  if (!listed.length) throw new Error('No NFTs returned for the contract; refusing to publish empty data.');
  console.log(`Listed ${listed.length} NFTs`);
  const collectionSlug = listed.map((n) => n.collection).find((c) => typeof c === 'string') ?? null;

  const listedIds = new Set(listed.map((n) => n.tokenId));
  const fetchErrors = {};
  const noWallet = new Set();

  // New tokens + a rotating slice of the oldest-checked cached ones
  const fresh = listed.filter((n) => !cache.tokens[n.tokenId]).map((n) => n.tokenId);
  const stale = listed
    .filter((n) => cache.tokens[n.tokenId])
    .sort((a, b) => (cache.tokens[a.tokenId].checked || 0) - (cache.tokens[b.tokenId].checked || 0))
    .slice(0, RECHECK).map((n) => n.tokenId);
  const toFetch = [...fresh, ...stale];
  console.log(`Fetching traits: ${fresh.length} new + ${stale.length} re-checks`);

  let fetched = 0, failed = 0, consecutiveFails = 0, aborted = false;
  await pool(toFetch, async (id) => {
    if (aborted || timeLeft() < 120_000) return; // leave time to scan wallets & write output
    try {
      const s = await fetchSingle(id);
      fetched++; consecutiveFails = 0;
      if (!s.wallet) {
        noWallet.add(id);
        if (!sampled.has('no-wallet-warning')) {
          sampled.add('no-wallet-warning');
          console.warn(`Token ${id}: no wallet trait found (${s.traitCount} traits). Check WALLET_TRAIT / field mapping.`);
        }
      }
      cache.tokens[id] = { wallet: s.wallet, owner: s.owner, checked: Date.now() };
    } catch (e) {
      failed++; consecutiveFails++;
      fetchErrors[id] = e.message;
      if (failed <= 5) console.warn(`  trait fetch failed for ${id}: ${e.message}`);
      if (consecutiveFails >= 15) {
        aborted = true;
        console.error('15 trait fetches failed in a row (likely rate limit / quota). Stopping trait fetching; progress is cached.');
      }
    }
    const done = fetched + failed;
    if (done % 25 === 0) console.log(`  traits: ${fetched} ok, ${failed} failed, ${done}/${toFetch.length} processed`);
    if (done % 100 === 0) await saveCache(cache);
  });
  await saveCache(cache);

  // Build the unique wallet set
  const wallets = [...new Set(listed.map((n) => cache.tokens[n.tokenId]?.wallet).filter(Boolean))];
  console.log(`Unique wallets: ${wallets.length}`);

  const results = new Map();
  let scanned = 0;
  if (TRAITS_ONLY) console.log('TRAITS_ONLY set: skipping NFT/token/ETH balance scans.');
  await pool(TRAITS_ONLY ? [] : wallets, async (w) => {
    if (timeLeft() < 30_000) { results.set(w, { ethBalance: 0, tokens: [], nfts: [], source: 'none', errors: ['skipped: time budget exhausted'] }); return; }
    try { results.set(w, await scanWallet(w)); }
    catch (e) { results.set(w, { ethBalance: 0, tokens: [], nfts: [], source: 'none', errors: [e.message] }); }
    scanned++;
    if (scanned % 25 === 0) console.log(`  wallets scanned: ${scanned}/${wallets.length}`);
  });

  // Retry wallets that hit rate limits, after a cooldown
  const needsRetry = () => wallets.filter((w) => {
    const r = results.get(w);
    return r && (r.source === 'none' || r.errors.some((m) => /HTTP (429|5\d\d)|network/.test(m) && !m.startsWith('eth')));
  });
  for (let pass = 1; pass <= 2 && !TRAITS_ONLY; pass++) {
    const list = needsRetry();
    if (!list.length || timeLeft() < 5 * 60_000) break;
    console.log(`Retry pass ${pass}: ${list.length} wallets after cooldown`);
    await sleep(30_000);
    await pool(list, async (w) => {
      if (timeLeft() < 60_000) return;
      try {
        const fresh = await scanWallet(w);
        const old = results.get(w);
        const bad = (x) => (x.source === 'none' ? 1 : 0) + x.errors.filter((m) => !m.startsWith('eth')).length;
        if (bad(fresh) <= bad(old)) results.set(w, fresh);
      } catch { /* keep old */ }
    }, 2);
  }

  // Collection name (best effort)
  let collectionName = null;
  if (collectionSlug) {
    try {
      const body = await getJson(`${OS}/api/v2/collections/${encodeURIComponent(collectionSlug)}`, { opensea: true });
      sample('collection', body);
      collectionName = pick(body, 'name') ?? null;
    } catch { /* optional */ }
  }

  const nfts = listed.map((n) => {
    const c = cache.tokens[n.tokenId] || {};
    const r = c.wallet ? results.get(c.wallet) : null;
    const errs = [];
    if (fetchErrors[n.tokenId]) errs.push(`traits: ${fetchErrors[n.tokenId]}`);
    if (!c.wallet && !fetchErrors[n.tokenId]) errs.push('no wallet trait found');
    if (r?.errors?.length) errs.push(...r.errors);
    return {
      tokenId: n.tokenId,
      name: n.name,
      image: n.image,
      owner: c.owner ?? null,
      wallet: c.wallet ?? null,
      ethBalance: r?.ethBalance ?? 0,
      ethUsd: r?.ethUsd ?? null,
      tokens: r?.tokens ?? [],
      nfts: r?.nfts ?? [],
      source: r?.source ?? 'none',
      error: errs.length ? errs.join('; ') : null,
    };
  }).sort((a, b) => Number(a.tokenId) - Number(b.tokenId) || a.tokenId.localeCompare(b.tokenId));

  const out = {
    generatedAt: new Date().toISOString(),
    collection: { contract: CONTRACT, chain: CHAIN, chainId: CHAIN_ID, slug: collectionSlug, name: collectionName, walletTrait: WALLET_TRAIT || null },
    nfts,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(out));

  // Summary (counts only; no secrets)
  const failedWallets = [...results.values()].filter((r) => r.errors.length).length;
  const bySource = {};
  for (const r of results.values()) bySource[r.source] = (bySource[r.source] || 0) + 1;
  console.log('\n===== Summary =====');
  console.log(`NFTs listed:        ${listed.length}`);
  console.log(`Without wallet:     ${listed.filter((n) => !cache.tokens[n.tokenId]?.wallet).length}`);
  console.log(`Trait fetch errors: ${Object.keys(fetchErrors).length}`);
  console.log(`Wallets scanned:    ${scanned}/${wallets.length}`);
  console.log(`Wallets w/ errors:  ${failedWallets}`);
  console.log(`Balance sources:    ${JSON.stringify(bySource)}`);
  const errSamples = [...new Set(nfts.map((n) => n.error).filter(Boolean))].slice(0, 5);
  if (errSamples.length) console.log(`Error examples:\n  - ${errSamples.join('\n  - ')}`);
  console.log(`Elapsed: ${Math.round((Date.now() - START) / 1000)}s`);
}

main().catch((e) => { console.error(`Indexer failed: ${e.message}`); process.exit(1); });
