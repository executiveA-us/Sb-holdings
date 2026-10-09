// Pure helpers (no network) so they can be unit-tested.

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Return the first defined, non-null value found at any of the dotted paths. */
export function pick(obj, ...paths) {
  for (const p of paths) {
    let cur = obj;
    for (const k of p.split('.')) {
      if (cur == null) { cur = undefined; break; }
      cur = cur[k];
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
}

/** Find the array of items in a response, trying known keys then any array-valued key. */
export function pickArray(body, ...keys) {
  if (Array.isArray(body)) return body;
  if (!isObj(body)) return [];
  for (const k of keys) if (Array.isArray(body[k])) return body[k];
  for (const v of Object.values(body)) if (Array.isArray(v)) return v;
  return [];
}

/** Normalise traits from either [{trait_type,value}] or {name: value} shapes. */
export function normTraits(raw) {
  if (Array.isArray(raw)) {
    return raw
      .filter(isObj)
      .map((t) => ({ name: String(t.trait_type ?? t.traitType ?? t.name ?? t.key ?? ''), value: t.value }));
  }
  if (isObj(raw)) return Object.entries(raw).map(([name, value]) => ({ name, value }));
  return [];
}

export function findWalletTrait(traits, forcedName) {
  const list = normTraits(traits);
  if (forcedName) {
    const want = forcedName.toLowerCase();
    const t = list.find((x) => x.name.toLowerCase() === want);
    return t && typeof t.value === 'string' && ADDRESS_RE.test(t.value.trim()) ? t.value.trim().toLowerCase() : null;
  }
  const t = list.find((x) => typeof x.value === 'string' && ADDRESS_RE.test(x.value.trim()));
  return t ? t.value.trim().toLowerCase() : null;
}

/** Convert a raw integer string (e.g. wei) into a JS number scaled by decimals. */
export function scaleUnits(raw, decimals) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 18;
  let s = String(raw);
  if (!/^\d+$/.test(s)) return Number(s) || 0; // already a decimal / float
  if (d === 0) return Number(s);
  s = s.padStart(d + 1, '0');
  return Number(`${s.slice(0, -d)}.${s.slice(-d)}`);
}

export function shortJson(v, max = 1800) {
  let s;
  try { s = JSON.stringify(v, null, 1); } catch { s = String(v); }
  return s && s.length > max ? s.slice(0, max) + ' …[truncated]' : s;
}

// ---- OpenSea parsers (defensive: field names unconfirmed) ----

export function parseListItem(it) {
  if (!isObj(it)) return null;
  const id = pick(it, 'identifier', 'token_id', 'tokenId', 'id');
  if (id === undefined) return null;
  return {
    tokenId: String(id),
    name: pick(it, 'name', 'metadata.name') ?? null,
    image: pick(it, 'display_image_url', 'image_url', 'image', 'metadata.image') ?? null,
  };
}

export function parseSingleNft(body, forcedTrait) {
  const nft = isObj(body?.nft) ? body.nft : isObj(body) ? body : {};
  const traits = pick(nft, 'traits', 'attributes', 'metadata.attributes');
  const owners = pick(nft, 'owners');
  let owner = null;
  if (Array.isArray(owners) && owners.length) {
    const o = owners[0];
    owner = (typeof o === 'string' ? o : pick(o, 'address', 'account.address')) ?? null;
  } else {
    owner = pick(nft, 'owner', 'owner.address') ?? null;
  }
  return {
    wallet: findWalletTrait(traits, forcedTrait),
    traitCount: normTraits(traits).length,
    name: pick(nft, 'name', 'metadata.name') ?? null,
    image: pick(nft, 'display_image_url', 'image_url', 'image') ?? null,
    owner: typeof owner === 'string' ? owner.toLowerCase() : null,
    collection: pick(nft, 'collection') ?? null,
  };
}

export function parseHeldNft(it) {
  if (!isObj(it)) return null;
  const id = pick(it, 'identifier', 'token_id', 'tokenId', 'id');
  const contract = pick(it, 'contract', 'contract_address', 'asset_contract.address', 'contract.address');
  if (id === undefined && contract === undefined) return null;
  return {
    collection: pick(it, 'collection', 'collection.name', 'collection.slug') ?? null,
    contract: typeof contract === 'string' ? contract : null,
    id: id === undefined ? null : String(id),
    name: pick(it, 'name', 'metadata.name') ?? null,
    image: pick(it, 'display_image_url', 'image_url', 'image') ?? null,
  };
}

export function parseOpenSeaToken(it) {
  if (!isObj(it)) return null;
  // Possibly nested under `currency`, `token`, or `asset`.
  const t = pick(it, 'currency', 'token', 'asset') ?? it;
  const decimals = Number(pick(t, 'decimals', 'currency_decimals') ?? pick(it, 'decimals') ?? 18);
  const rawQty = pick(it, 'quantity', 'balance', 'amount', 'raw_quantity');
  const formatted = pick(it, 'formatted_quantity', 'quantity_formatted');
  return {
    symbol: pick(t, 'symbol', 'currency_symbol') ?? pick(it, 'symbol') ?? null,
    name: pick(t, 'name') ?? pick(it, 'name') ?? null,
    address: pick(t, 'address', 'contract_address', 'contract') ?? pick(it, 'address') ?? null,
    decimals,
    quantity: formatted !== undefined ? Number(formatted) : scaleUnits(rawQty, decimals),
    usd: numOrNull(pick(it, 'usd_value', 'usd_price_total', 'value_usd', 'usd', 'fiat_value', 'usd_balance')),
    _usdUnit: numOrNull(pick(it, 'usd_price', 'price_usd', 'price.usd')),
  };
}

export function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- Blockscout parsers ----

export function parseBlockscoutEth(body) {
  const raw = pick(body, 'coin_balance');
  return {
    eth: raw === undefined ? 0 : scaleUnits(raw, 18),
    rate: numOrNull(pick(body, 'exchange_rate')),
  };
}

export function parseBlockscoutTokens(body) {
  const items = pickArray(body, 'items');
  const out = [];
  for (const it of items) {
    if (!isObj(it) || !isObj(it.token)) continue;
    const type = it.token.type;
    if (type && type !== 'ERC-20') continue;
    const decimals = Number(it.token.decimals ?? 18);
    const quantity = scaleUnits(it.value, decimals);
    if (!quantity) continue;
    const rate = numOrNull(it.token.exchange_rate);
    out.push({
      symbol: it.token.symbol ?? null,
      name: it.token.name ?? null,
      address: it.token.address_hash ?? it.token.address ?? null,
      decimals,
      quantity,
      usd: rate === null ? null : quantity * rate,
    });
  }
  return out;
}
