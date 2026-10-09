'use strict';
// All data-derived strings are rendered with textContent / property assignment — never innerHTML.

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const $ = (id) => document.getElementById(id);
const state = { data: null, nfts: [], q: '', sort: 'id', holding: false, view: 'nfts', limit: 60, traits: {}, noStar: false };
const PAGE = 60;
const traitsActive = () => Object.keys(state.traits).length;
const matchesTraits = (n) => Object.entries(state.traits).every(([k, v]) => n.traits && n.traits[k] === v);

function buildTraitUI() {
  const idx = new Map();
  for (const n of state.nfts) {
    for (const [k, v] of Object.entries(n.traits || {})) {
      if (!idx.has(k)) idx.set(k, new Map());
      idx.get(k).set(v, (idx.get(k).get(v) || 0) + 1);
    }
  }
  const box = $('traits-box'), grid = $('traits-grid');
  box.hidden = idx.size === 0;
  grid.replaceChildren();
  for (const [type, vals] of [...idx.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sel = el('select', { attrs: { 'aria-label': type, 'data-trait': type } }, [el('option', { text: 'Any', attrs: { value: '' } })]);
    for (const [v, c] of [...vals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) sel.append(el('option', { text: `${v} (${c})`, attrs: { value: v } }));
    sel.value = state.traits[type] || '';
    sel.addEventListener('change', () => {
      if (sel.value) state.traits[type] = sel.value; else delete state.traits[type];
      updateTraitSummary(); rerender();
    });
    grid.append(el('label', {}, [el('span', { text: type }), sel]));
  }
  updateTraitSummary();
}
function updateTraitSummary() {
  const n = traitsActive();
  $('traits-sum').textContent = n ? `Filter by traits (${n} active)` : 'Filter by traits';
}
function clearTraits() {
  state.traits = {};
  for (const sel of $('traits-grid').querySelectorAll('select')) sel.value = '';
  updateTraitSummary();
}

function el(tag, opts = {}, children = []) {
  const n = document.createElement(tag);
  if (opts.cls) n.className = opts.cls;
  if (opts.text !== undefined) n.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs || {})) n.setAttribute(k, v);
  for (const c of children) n.append(c);
  return n;
}
const ago = (d) => { const m = Math.round((Date.now() - d.getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const fmtNum = (n, d = 4) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : '—');
const fmtUsd = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : '—');
const safeImg = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const toStr = (v) => (v === null || v === undefined ? '' : String(v));

const isUncertain = (t) => !!t && t.status !== null && t.status !== undefined && String(t.status).toUpperCase() !== 'OK';
const usdOf = (n) => (n.tokens || []).reduce((s, t) => s + (Number.isFinite(t.usd) && !(state.noStar && isUncertain(t)) ? t.usd : 0), 0) + (Number.isFinite(n.ethUsd) ? n.ethUsd : 0);
const holds = (n) => (n.ethBalance || 0) > 0 || (n.tokens || []).length > 0 || (n.nfts || []).length > 0;

function imageBox(url, alt) {
  const box = el('div', { cls: 'img' });
  const src = safeImg(url);
  if (!src) { box.textContent = 'No image'; return box; }
  const img = el('img', { attrs: { alt, loading: 'lazy', referrerpolicy: 'no-referrer' } });
  img.addEventListener('error', () => { img.remove(); box.textContent = 'No image'; });
  img.src = src;
  box.append(img);
  return box;
}

function renderStats() {
  const nfts = state.nfts;
  const wallets = new Map();
  for (const n of nfts) if (n.wallet && !wallets.has(n.wallet)) wallets.set(n.wallet, n);
  const hold = [...wallets.values()].filter(holds).length;
  const eth = [...wallets.values()].reduce((s, n) => s + (n.ethBalance || 0), 0);
  const usd = [...wallets.values()].reduce((s, n) => s + usdOf(n), 0);
  const box = $('stats');
  box.replaceChildren();
  for (const [label, val] of [['NFTs', fmtNum(nfts.length, 0)], ['Wallets holding something', fmtNum(hold, 0)], ['Total ETH', fmtNum(eth)], ['Total USD', fmtUsd(usd)]]) {
    box.append(el('div', { cls: 'stat' }, [el('b', { text: val }), el('span', { text: label })]));
  }
}

function visible() {
  const q = state.q.trim().toLowerCase();
  let list = state.nfts.filter((n) => {
    if (state.holding && !holds(n)) return false;
    if (traitsActive() && !matchesTraits(n)) return false;
    if (!q) return true;
    return toStr(n.tokenId).toLowerCase().includes(q) || toStr(n.wallet).toLowerCase().includes(q) || toStr(n.name).toLowerCase().includes(q);
  });
  const key = { eth: (n) => n.ethBalance || 0, usd: usdOf, nfts: (n) => (n.nfts || []).length }[state.sort];
  list = list.slice();
  if (state.sort === 'nfts') list.sort((a, b) => (b.nfts || []).length - (a.nfts || []).length || usdOf(b) - usdOf(a));
  else if (key) list.sort((a, b) => key(b) - key(a));
  else list.sort((a, b) => Number(a.tokenId) - Number(b.tokenId) || toStr(a.tokenId).localeCompare(toStr(b.tokenId)));
  return list;
}

function renderGrid() {
  if (state.view === 'holders') return renderHolders();
  const list = visible();
  $('count').textContent = list.length ? `${list.length} of ${state.nfts.length} NFTs` : 'No NFTs match your filters.';
  const grid = $('grid');
  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  showMore(list.length);
  for (const n of list.slice(0, state.limit)) {
    const chips = el('div', { cls: 'chips' }, [
      el('span', { cls: 'chip', text: `${fmtNum(n.ethBalance || 0)} ETH` }),
      el('span', { cls: 'chip', text: `${(n.tokens || []).length} tokens` }),
      el('span', { cls: 'chip', text: `${(n.nfts || []).length} NFTs` }),
    ]);
    if (n.error) chips.append(el('span', { cls: 'chip err', text: '⚠ error', attrs: { title: toStr(n.error) } }));
    const card = el('button', { cls: 'card', attrs: { type: 'button' } }, [
      imageBox(n.image, toStr(n.name) || `#${toStr(n.tokenId)}`),
      el('div', { cls: 'body' }, [
        el('div', { cls: 'name', text: toStr(n.name) || `#${toStr(n.tokenId)}` }),
        el('div', { cls: 'addr', text: n.wallet ? short(n.wallet) : 'no wallet' }),
        chips,
      ]),
    ]);
    card.addEventListener('click', () => openPanel(n));
    frag.append(card);
  }
  grid.append(frag);
}


function showMore(total) {
  const b = $('more');
  b.hidden = total <= state.limit;
  b.textContent = `Show more (${Math.max(0, total - state.limit)} left)`;
  $('reset').hidden = !(state.q || state.holding || traitsActive());
}
const rerender = () => { state.limit = PAGE; renderGrid(); };

// ---------- holders view ----------
function buildHolders() {
  const map = new Map();
  for (const n of state.nfts) {
    const o = typeof n.owner === 'string' && isAddr(n.owner) ? n.owner.toLowerCase() : null;
    if (!o) continue;
    if (!map.has(o)) map.set(o, { owner: o, nfts: [] });
    map.get(o).nfts.push(n);
  }
  return [...map.values()].map((h) => {
    const wallets = new Map();
    for (const n of h.nfts) if (n.wallet && !wallets.has(n.wallet)) wallets.set(n.wallet, n);
    const ws = [...wallets.values()];
    return { ...h, eth: ws.reduce((s, n) => s + (n.ethBalance || 0), 0), usd: ws.reduce((s, n) => s + usdOf(n), 0), holding: ws.some(holds) };
  });
}

function visibleHolders() {
  const q = state.q.trim().toLowerCase();
  let list = buildHolders().filter((h) => {
    if (state.holding && !h.holding) return false;
    if (traitsActive() && !h.nfts.some(matchesTraits)) return false;
    if (!q) return true;
    return h.owner.includes(q) || h.nfts.some((n) => toStr(n.tokenId).toLowerCase() === q || toStr(n.name).toLowerCase().includes(q) || toStr(n.wallet).toLowerCase().includes(q));
  });
  const key = { eth: (h) => h.eth, usd: (h) => h.usd, nfts: (h) => h.nfts.length, count: (h) => h.nfts.length }[state.sort] || ((h) => h.nfts.length);
  const tie = state.sort === 'eth' || state.sort === 'usd' ? 0 : 1;
  list.sort((a, b) => key(b) - key(a) || (tie ? b.usd - a.usd : 0) || a.owner.localeCompare(b.owner));
  return list;
}

function renderHolders() {
  const list = visibleHolders();
  const total = new Set(state.nfts.map((n) => n.owner).filter(Boolean)).size;
  $('count').textContent = total ? `${list.length} of ${total} holders` : 'No holder data yet — it appears after the next index run.';
  const grid = $('grid');
  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  showMore(list.length);
  for (const h of list.slice(0, state.limit)) {
    const first = h.nfts[0];
    const card = el('button', { cls: 'card', attrs: { type: 'button' } }, [
      imageBox(first.image, toStr(first.name)),
      el('div', { cls: 'body' }, [
        el('div', { cls: 'name', text: `${h.nfts.length} Stonk Broker${h.nfts.length === 1 ? '' : 's'}` }),
        el('div', { cls: 'addr', text: short(h.owner) }),
        el('div', { cls: 'chips' }, [
          el('span', { cls: 'chip', text: `${fmtNum(h.eth)} ETH` }),
          el('span', { cls: 'chip', text: fmtUsd(h.usd) }),
        ]),
      ]),
    ]);
    card.addEventListener('click', () => openHolder(h));
    frag.append(card);
  }
  grid.append(frag);
}

let currentHolder = null;
function renderHolderNfts() {
  const h = currentHolder;
  if (!h) return;
  const keys = { usd: (n) => -usdOf(n), usdasc: (n) => usdOf(n), eth: (n) => -(n.ethBalance || 0), id: (n) => Number(n.tokenId) };
  const key = keys[$('h-sort').value] || keys.nfts;
  const grid = $('h-nfts');
  grid.replaceChildren();
  const mode = $('h-sort').value;
  const byNfts = (a, b) => (b.nfts || []).length - (a.nfts || []).length || usdOf(b) - usdOf(a);
  const cmp = mode === 'nfts' ? byNfts : (a, b) => key(a) - key(b);
  for (const n of h.nfts.slice().sort((a, b) => cmp(a, b) || Number(a.tokenId) - Number(b.tokenId))) {
    const card = el('button', { cls: 'card', attrs: { type: 'button' } }, [
      imageBox(n.image, toStr(n.name)),
      el('div', { cls: 'body' }, [
        el('div', { cls: 'name', text: toStr(n.name) || `#${toStr(n.tokenId)}` }),
        el('div', { cls: 'addr', text: n.wallet ? short(n.wallet) : 'no wallet' }),
        el('div', { cls: 'chips' }, [
          el('span', { cls: 'chip', text: fmtUsd(usdOf(n)) }),
          el('span', { cls: 'chip', text: `${fmtNum(n.ethBalance || 0)} ETH` }),
          el('span', { cls: 'chip', text: `${(n.nfts || []).length} NFTs` }),
        ]),
      ]),
    ]);
    card.addEventListener('click', () => openPanel(n));
    grid.append(card);
  }
}

function renderHolderStats() {
  const h = currentHolder;
  const wallets = new Map();
  for (const n of h.nfts) if (n.wallet && !wallets.has(n.wallet)) wallets.set(n.wallet, n);
  const inside = [...wallets.values()].reduce((s, n) => s + (n.nfts || []).length, 0);
  const stats = $('h-stats');
  stats.replaceChildren();
  for (const [label, val] of [['Stonk Brokers held', fmtNum(h.nfts.length, 0)], ['Total USD in wallets', fmtUsd(h.usd)], ['Total ETH', fmtNum(h.eth)], ['Other NFTs inside wallets', fmtNum(inside, 0)]]) {
    stats.append(el('div', { cls: 'stat' }, [el('b', { text: val }), el('span', { text: label })]));
  }
}

function openHolder(h) {
  currentHolder = h;
  $('h-title').textContent = `Holder ${short(h.owner)}`;
  $('h-addr').textContent = h.owner;
  $('h-link').href = `${EXPLORER}/address/${h.owner}`;
  const copy = $('h-copy');
  copy.textContent = 'Copy';
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(h.owner); copy.textContent = 'Copied ✓'; } catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => (copy.textContent = 'Copy'), 1500);
  };
  renderHolderStats();
  $('h-sort').value = 'nfts';
  renderHolderNfts();
  $('hpanel').hidden = false;
  document.body.style.overflow = 'hidden';
  setHash(`#holder-${h.owner}`);
  $('h-close').focus();
}
function closeHolder() { $('hpanel').hidden = true; if ($('panel').hidden) { document.body.style.overflow = ''; setHash(''); } }

// ---------- live refresh (browser -> public Blockscout API, no API key involved) ----------
async function bsJson(path) {
  const res = await fetch(`${EXPLORER}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}
const scaleStr = (raw, dec) => {
  const d = Number.isFinite(Number(dec)) ? Number(dec) : 18;
  const s = String(raw ?? '0');
  if (!/^\d+$/.test(s)) return Number(s) || 0;
  const p = s.padStart(d + 1, '0');
  return d === 0 ? Number(p) : Number(`${p.slice(0, -d)}.${p.slice(-d)}`);
};
const numOrNull = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };

async function refreshNft(n) {
  const status = $('p-refresh-status'), btn = $('p-refresh');
  if (!isAddr(n.wallet)) return;
  btn.disabled = true; status.textContent = 'Refreshing…';
  const w = n.wallet;
  const [addr, toks, nfts] = await Promise.allSettled([
    bsJson(`/api/v2/addresses/${w}`),
    bsJson(`/api/v2/addresses/${w}/token-balances`),
    bsJson(`/api/v2/addresses/${w}/nft?type=ERC-721%2CERC-1155`),
  ]);
  const ok = [addr, toks, nfts].filter((r) => r.status === 'fulfilled').length;
  const notFound = (r) => r.status === 'rejected' && r.reason && r.reason.status === 404;
  if (ok === 0 && ![addr, toks, nfts].every(notFound)) {
    status.textContent = 'Refresh failed (the explorer may be rate-limiting or blocking browser requests). Try again later.';
    btn.disabled = false; return;
  }
  if (addr.status === 'fulfilled') {
    n.ethBalance = scaleStr(addr.value?.coin_balance, 18);
    const rate = numOrNull(addr.value?.exchange_rate);
    n.ethUsd = rate === null ? null : n.ethBalance * rate;
  } else if (notFound(addr)) { n.ethBalance = 0; n.ethUsd = 0; }
  if (toks.status === 'fulfilled' && Array.isArray(toks.value)) {
    n.tokens = toks.value.filter((it) => it && it.token && (!it.token.type || it.token.type === 'ERC-20')).map((it) => {
      const dec = Number(it.token.decimals ?? 18);
      const q = scaleStr(it.value, dec), rate = numOrNull(it.token.exchange_rate);
      return { symbol: it.token.symbol ?? null, name: it.token.name ?? null, address: it.token.address_hash ?? it.token.address ?? null, decimals: dec, quantity: q, usd: rate === null ? null : q * rate };
    }).filter((t) => t.quantity > 0);
  } else if (notFound(toks)) n.tokens = [];
  if (nfts.status === 'fulfilled' && Array.isArray(nfts.value?.items)) {
    n.nfts = nfts.value.items.map((it) => ({
      collection: it?.token?.name ?? null,
      contract: it?.token?.address_hash ?? it?.token?.address ?? null,
      id: it?.id === undefined || it?.id === null ? null : String(it.id),
      name: it?.metadata?.name ?? null,
      image: it?.image_url ?? it?.metadata?.image ?? null,
    }));
  } else if (notFound(nfts)) n.nfts = [];
  n.source = 'explorer (live)';
  n.refreshedAt = new Date().toISOString();
  const partial = ok < 3 && !(addr.status === 'rejected' && toks.status === 'rejected' && nfts.status === 'rejected');
  renderStats(); renderGrid();
  if (!$('hpanel').hidden && currentHolder) {
    const fresh = buildHolders().find((x) => x.owner === currentHolder.owner);
    if (fresh) { currentHolder = fresh; renderHolderStats(); renderHolderNfts(); }
  }
  openPanel(n);
  $('p-refresh-status').textContent = `Refreshed ${new Date().toLocaleTimeString()}${partial ? ' (partly — some parts could not be loaded)' : ''}. Not saved; the next index run replaces it.`;
}

function openPanel(n) {
  $('p-title').textContent = toStr(n.name) || `#${toStr(n.tokenId)}`;
  $('p-addr').textContent = n.wallet || 'No wallet found';
  const link = $('p-link'), copy = $('p-copy');
  if (isAddr(n.wallet)) {
    link.href = `${EXPLORER}/address/${n.wallet}`; link.hidden = false; copy.hidden = false;
    copy.textContent = 'Copy';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(n.wallet); copy.textContent = 'Copied ✓'; } catch { copy.textContent = 'Copy failed'; }
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    };
  } else { link.hidden = true; copy.hidden = true; }
  $('p-meta').textContent = `Token #${toStr(n.tokenId)} · ETH ${fmtNum(n.ethBalance || 0, 6)} · balances via ${toStr(n.source) || 'n/a'}` + (n.error ? ` · errors: ${toStr(n.error)}` : '');

  const ob = $('p-owner');
  const ownerAddr = isAddr(n.owner) ? n.owner.toLowerCase() : null;
  ob.hidden = !ownerAddr;
  if (ownerAddr) {
    ob.textContent = short(ownerAddr);
    ob.onclick = () => {
      const h = buildHolders().find((x) => x.owner === ownerAddr);
      if (!h) return;
      if (!$('hpanel').hidden && currentHolder && currentHolder.owner === ownerAddr) { closePanel(); return; }
      closePanel(); openHolder(h);
    };
  }
  const back = $('p-back');
  back.hidden = $('hpanel').hidden;
  if (!back.hidden) back.onclick = closePanel;
  const rb = $('p-refresh');
  rb.hidden = !isAddr(n.wallet);
  rb.disabled = false;
  $('p-refresh-status').textContent = n.refreshedAt ? `Last live refresh ${new Date(n.refreshedAt).toLocaleTimeString()}` : '';
  rb.onclick = () => refreshNft(n);

  const table = $('p-tokens');
  table.replaceChildren();
  const head = el('tr', {}, [el('th', { text: 'Token' }), el('th', { cls: 'num', text: 'Quantity' }), el('th', { cls: 'num', text: 'USD' })]);
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  let starred = false;
  const rows = [];
  if ((n.ethBalance || 0) > 0) rows.push({ symbol: 'ETH', name: 'Ether (native)', quantity: n.ethBalance, usd: n.ethUsd });
  rows.push(...(n.tokens || []));
  if (!rows.length) body.append(el('tr', {}, [el('td', { text: 'No tokens', attrs: { colspan: '3' } })]));
  for (const t of rows) {
    const sym = el('div', { text: toStr(t.symbol) || '?' });
    if (isUncertain(t)) { starred = true; sym.append(' ', el('span', { cls: 'star', text: '★', attrs: { title: `OpenSea status: ${toStr(t.status)} — unverified, may be spam`, 'aria-label': 'unverified token' } })); }
    const label = el('td', {}, [sym, el('div', { cls: 'muted', text: toStr(t.name) })]);
    body.append(el('tr', {}, [label, el('td', { cls: 'num', text: fmtNum(t.quantity, 6) }), el('td', { cls: 'num', text: fmtUsd(t.usd) })]));
  }
  table.append(body);
  $('p-star-note').hidden = !starred;
  const tc = $('p-traits');
  tc.replaceChildren();
  for (const [k, v] of Object.entries(n.traits || {})) tc.append(el('span', { cls: 'chip trait', text: `${k}: ${v}` }));

  const grid = $('p-nfts');
  grid.replaceChildren();
  const held = n.nfts || [];
  $('p-nft-count').textContent = `(${held.length})`;
  if (!held.length) grid.append(el('p', { cls: 'muted', text: 'No NFTs' }));
  for (const h of held) {
    const ok = isAddr(h.contract) && /^\d+$/.test(toStr(h.id));
    const label = toStr(h.name) || (h.id ? `#${toStr(h.id)}` : 'Unnamed');
    const card = el(ok ? 'a' : 'div', { cls: 'card' }, [
      imageBox(h.image, label),
      el('div', { cls: 'body' }, [
        el('div', { cls: 'name', text: label }),
        el('div', { cls: 'addr', text: toStr(typeof h.collection === 'string' ? h.collection : '') || short(h.contract) }),
      ]),
    ]);
    if (ok) {
      card.href = `https://opensea.io/item/robinhood/${h.contract}/${h.id}`;
      card.target = '_blank'; card.rel = 'noopener noreferrer';
    }
    grid.append(card);
  }
  $('panel').hidden = false;
  document.body.style.overflow = 'hidden';
  setHash(`#nft-${encodeURIComponent(toStr(n.tokenId))}`);
  $('close').focus();
}
function setHash(h) { try { history.replaceState(null, '', h || location.pathname + location.search); } catch { /* ignore */ } }
function closePanel() {
  $('panel').hidden = true;
  if (!$('hpanel').hidden && currentHolder) { setHash(`#holder-${currentHolder.owner}`); $('hpanel').focus?.(); }
  else { document.body.style.overflow = ''; setHash(''); }
}

function showEmpty(msg) { const e = $('empty'); e.textContent = msg; e.hidden = false; }

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch { /* ignore */ }
  if (saved) document.documentElement.dataset.theme = saved;
  $('theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
  });
}

async function main() {
  initTheme();
  $('close').addEventListener('click', closePanel);
  $('h-close').addEventListener('click', closeHolder);
  $('h-sort').addEventListener('change', renderHolderNfts);
  $('hpanel').addEventListener('click', (e) => { if (e.target === $('hpanel')) closeHolder(); });
  const setView = (v) => {
    state.view = v;
    $('tab-nfts').classList.toggle('active', v === 'nfts');
    $('tab-holders').classList.toggle('active', v === 'holders');
    const sel = $('sort');
    sel.replaceChildren(...(v === 'nfts'
      ? [['id', 'Sort: token id'], ['eth', 'Sort: ETH'], ['usd', 'Sort: USD value'], ['nfts', 'Sort: NFT count']]
      : [['count', 'Sort: Stonk Brokers held'], ['eth', 'Sort: ETH'], ['usd', 'Sort: USD value']]
    ).map(([val, label]) => el('option', { text: label, attrs: { value: val } })));
    state.sort = sel.value;
    rerender();
  };
  $('tab-nfts').addEventListener('click', () => setView('nfts'));
  $('tab-holders').addEventListener('click', () => setView('holders'));
  $('panel').addEventListener('click', (e) => { if (e.target === $('panel')) closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('panel').hidden) closePanel(); else if (!$('hpanel').hidden) closeHolder(); } });
  $('q').addEventListener('input', (e) => { state.q = e.target.value; rerender(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; rerender(); });
  $('holding').addEventListener('change', (e) => { state.holding = e.target.checked; rerender(); });
  $('more').addEventListener('click', () => { state.limit += PAGE; renderGrid(); });
  $('reset').addEventListener('click', () => { state.q = ''; state.holding = false; $('q').value = ''; $('holding').checked = false; clearTraits(); rerender(); });
  $('traits-clear').addEventListener('click', () => { clearTraits(); rerender(); });
  $('nostar').addEventListener('change', (e) => { state.noStar = e.target.checked; renderStats(); rerender(); });

  let data;
  try {
    const res = await fetch('data/wallets.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    $('updated').textContent = 'No data yet';
    showEmpty('The data could not be loaded. If you just deployed, wait a minute and reload; otherwise the first scan may not have finished yet.');
    renderStats();
    return;
  }
  state.data = data;
  state.nfts = Array.isArray(data?.nfts) ? data.nfts.filter((n) => n && typeof n === 'object') : [];
  const c = data?.collection || {};
  const t = new Date(data?.generatedAt);
  $('updated').textContent = Number.isNaN(t.getTime()) ? 'Last updated: unknown' : `Wallet browser · last scan ${ago(t)}`;
  renderStats();
  buildTraitUI();
  if (!state.nfts.length) showEmpty('The data file contains no NFTs yet — check back soon.');
  renderGrid();
  const m = /^#(nft|holder)-(.+)$/.exec(location.hash);
  if (m) {
    const key = decodeURIComponent(m[2]).toLowerCase();
    if (m[1] === 'nft') { const n = state.nfts.find((x) => toStr(x.tokenId) === key); if (n) openPanel(n); }
    else { const h = buildHolders().find((x) => x.owner === key); if (h) openHolder(h); }
  }
}
main();
