# Sb-holdings — per-NFT wallet browser

A static site that lists every NFT in a collection together with the wallet stored in
its traits, and what each wallet holds (ETH, ERC-20 tokens, NFTs).

Default collection: `0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0` on Robinhood Chain
(chain ID 4663, OpenSea slug `robinhood`).

## How it works

1. A GitHub Action (`.github/workflows/index.yml`) runs every 6 hours and on demand. A full scan of ~4,400 wallets takes about an hour, so frequent schedules would just overlap; use the site's per-NFT refresh for anything you want to check right now.
2. `indexer/index.mjs` (Node 20, no dependencies):
   - lists all NFTs in the contract via the OpenSea API,
   - reads each NFT's traits and takes the first trait whose value is a `0x` address as its wallet
     (token → wallet is cached via `actions/cache`; each run fetches only new tokens plus a rotating
     slice of `RECHECK_PER_RUN` (default 60) cached ones, oldest-checked first),
   - for each unique wallet fetches NFTs held and token balances from OpenSea (spam filter on),
     falling back to Blockscout if OpenSea errors; native ETH comes from Blockscout,
   - writes `site/data/wallets.json` (not committed — it only lives in the deployed artifact).
3. `site/` (plain HTML/CSS/JS) is uploaded and deployed to GitHub Pages.

The `OPENSEA_API_KEY` secret is only read inside the indexer step in Actions and sent as a request
header. It is never logged or written to the site. All on-chain/metadata strings are rendered with
`textContent`, and the page has a strict Content-Security-Policy.

## Using the site

- **NFTs** tab: one card per NFT with its wallet. **Holders** tab: groups NFTs by the address that owns them.
- Click a card for the wallet's ETH, token balances and NFTs. Links like `…/#nft-123` and `…/#holder-0x…` can be shared.
- **↻ Refresh from explorer** re-reads that one wallet live, straight from the public Blockscout API in the visitor's browser (no API key involved). It is not saved: the next index run replaces it. If the explorer rate-limits or blocks browser requests, the button says so.
- ETH comes from OpenSea's token list (native ETH appears as `ETH`); no entry means 0 ETH. Blockscout is used only if OpenSea's token call fails for a wallet.
- The owner (holder) of each NFT is refreshed gradually: each run re-checks `RECHECK_PER_RUN` (default 400) NFTs, owner-less and oldest first.


**Site-only changes:** run the workflow with *reuse_data* ticked to redeploy the site in about a minute using the currently published `wallets.json` (no indexing, no OpenSea calls).

- **Traits:** each NFT's traits (the wallet-address trait is excluded) are shown on its panel and can be used in the **Filter by traits** box. Filters combine with search and apply to both the NFTs and Holders tabs.
- **★ tokens:** any token whose OpenSea `status` isn't `OK` is starred and a notice at the top of the page says starred tokens aren't verified as safe. They still count toward USD unless "Don't count ★ tokens in USD" is ticked.
- **Branding / sharing:** logo, banner and the social preview image (`og.jpg`, 1200×630) live in `site/assets/`. The Open Graph / Twitter tags in `site/index.html` use the absolute URL `https://executivea-us.github.io/Sb-holdings/`; update it if the repo is renamed.

## Setup

1. Repo **Settings → Secrets and variables → Actions**: secret `OPENSEA_API_KEY` (already set).
2. **Settings → Pages → Source: GitHub Actions**.
3. **Actions → "Index wallets & deploy site" → Run workflow** (pick the branch that contains the workflow;
   scheduled runs only fire from the default branch, so merge this branch into it for the 30-minute schedule).
4. Open the Pages URL shown in the job's `deploy` step.

If an Environment protection rule restricts `github-pages` deployments to certain branches, allow the branch you run from.

## Changing the collection or wallet trait

Add repository **variables** (Settings → Secrets and variables → Actions → Variables):

| Variable | Meaning | Default |
|---|---|---|
| `CONTRACT` | collection contract address | `0x539cdd…fabf0` |
| `WALLET_TRAIT` | force a specific trait name for the wallet | auto-detect first `0x…` trait |

Other env options (see top of `indexer/index.mjs`): `OPENSEA_CHAIN`, `CHAIN_ID`, `CONCURRENCY` (max 3),
`RECHECK_PER_RUN`, `MAX_RUNTIME_MIN`, `MIN_GAP_MS`. If you change the contract or trait, the cache is discarded automatically.

## First-run logs

OpenSea's exact response fields were unconfirmed when this was written, so parsers are defensive and the
first run logs `[sample]` blocks (top-level keys + one sample item per endpoint) and a final summary.
Use them to tune the mappings in `indexer/lib.mjs` (`parse*` functions).

## Local development

```
cd indexer && node --test         # parser unit tests (no network)
```
The indexer needs the API key, which should only be used in Actions. To preview the UI, put a sample
`wallets.json` in `site/data/` and run `python3 -m http.server -d site`.
