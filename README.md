# Sb-holdings — per-NFT wallet browser

A static site that lists every NFT in a collection together with the wallet stored in
its traits, and what each wallet holds (ETH, ERC-20 tokens, NFTs).

Default collection: `0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0` on Robinhood Chain
(chain ID 4663, OpenSea slug `robinhood`).

## How it works

1. A GitHub Action (`.github/workflows/index.yml`) runs every 30 minutes and on demand.
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
