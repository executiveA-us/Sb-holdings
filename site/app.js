'use strict';
// All data-derived strings are rendered with textContent / property assignment — never innerHTML.

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const $ = (id) => document.getElementById(id);
const state = { data: null, nfts: [], q: '', sort: 'id', holding: false };

function el(tag, opts = {}, children = []) {
  const n = document.createElement(tag);
  if (opts.cls) n.className = opts.cls;
  if (opts.text !== undefined) n.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs || {})) n.setAttribute(k, v);
  for (const c of children) n.append(c);
  return n;
}
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const fmtNum = (n, d = 4) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : '—');
const fmtUsd = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : '—');
const safeImg = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const toStr = (v) => (v === null || v === undefined ? '' : String(v));

const usdOf = (n) => (n.tokens || []).reduce((s, t) => s + (Number.isFinite(t.usd) ? t.usd : 0), 0) + (Number.isFinite(n.ethUsd) ? n.ethUsd : 0);
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
    if (!q) return true;
    return toStr(n.tokenId).toLowerCase().includes(q) || toStr(n.wallet).toLowerCase().includes(q) || toStr(n.name).toLowerCase().includes(q);
  });
  const key = { eth: (n) => n.ethBalance || 0, usd: usdOf, nfts: (n) => (n.nfts || []).length }[state.sort];
  list = list.slice();
  if (key) list.sort((a, b) => key(b) - key(a));
  else list.sort((a, b) => Number(a.tokenId) - Number(b.tokenId) || toStr(a.tokenId).localeCompare(toStr(b.tokenId)));
  return list;
}

function renderGrid() {
  const list = visible();
  $('count').textContent = `${list.length} of ${state.nfts.length} NFTs`;
  const grid = $('grid');
  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const n of list) {
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

  const table = $('p-tokens');
  table.replaceChildren();
  const head = el('tr', {}, [el('th', { text: 'Token' }), el('th', { cls: 'num', text: 'Quantity' }), el('th', { cls: 'num', text: 'USD' })]);
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  const rows = [];
  if ((n.ethBalance || 0) > 0) rows.push({ symbol: 'ETH', name: 'Ether (native)', quantity: n.ethBalance, usd: n.ethUsd });
  rows.push(...(n.tokens || []));
  if (!rows.length) body.append(el('tr', {}, [el('td', { text: 'No tokens', attrs: { colspan: '3' } })]));
  for (const t of rows) {
    const label = el('td', {}, [el('div', { text: toStr(t.symbol) || '?' }), el('div', { cls: 'muted', text: toStr(t.name) })]);
    body.append(el('tr', {}, [label, el('td', { cls: 'num', text: fmtNum(t.quantity, 6) }), el('td', { cls: 'num', text: fmtUsd(t.usd) })]));
  }
  table.append(body);

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
  $('close').focus();
}
function closePanel() { $('panel').hidden = true; document.body.style.overflow = ''; }

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
  $('panel').addEventListener('click', (e) => { if (e.target === $('panel')) closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderGrid(); });
  $('holding').addEventListener('change', (e) => { state.holding = e.target.checked; renderGrid(); });

  let data;
  try {
    const res = await fetch('data/wallets.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    $('updated').textContent = 'No data yet';
    showEmpty('Could not load data/wallets.json. Run the "Index wallets & deploy site" workflow to generate it.');
    renderStats();
    return;
  }
  state.data = data;
  state.nfts = Array.isArray(data?.nfts) ? data.nfts.filter((n) => n && typeof n === 'object') : [];
  const c = data?.collection || {};
  if (c.name) { $('title').textContent = `${toStr(c.name)} — wallets`; document.title = `${toStr(c.name)} wallets`; }
  const t = new Date(data?.generatedAt);
  $('updated').textContent = Number.isNaN(t.getTime()) ? 'Last updated: unknown' : `Last updated: ${t.toLocaleString()}`;
  renderStats();
  if (!state.nfts.length) showEmpty('The data file contains no NFTs.');
  renderGrid();
}
main();
