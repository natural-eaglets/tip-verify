# TIP Verify

Generic on-chain integrity verification for software installs and Git repositories.

TIP Verify computes deterministic source manifests, stores full manifests on IPFS, and publishes Merkle roots to a Ternoa zkEVM registry. Users can then verify that a local install still matches a known published snapshot.

Hermes Agent is the first supported integration. The design is intentionally generic so additional repositories, packages, installers, and release channels can be added later.

## Current Mainnet Deployment

- Registry: `0x536625F6c65FBF7cC053Fb47ccc240aF9cF1bdFf`
- Chain: Ternoa zkEVM mainnet
- Chain ID: `752025`
- RPC: `https://rpc-mainnet.zkevm.ternoa.network/`
- Explorer: `https://explorer-mainnet.zkevm.ternoa.network/address/0x536625f6c65fbf7cc053fb47ccc240af9cf1bdff`

## User CLI

Verify a generic Git checkout:

```bash
npx tip-verify verify --path /path/to/repo --source github:owner/repo
```

Verify a supported installed product:

```bash
npx tip-verify verify --hermes
```

Inspect the latest registered root for a subject:

```bash
npx tip-verify status github:NousResearch/hermes-agent
```

Generate a local manifest without reading the chain:

```bash
npx tip-verify manifest --path /path/to/repo
```

The exact `npx tip verify` command requires owning the `tip` npm package or publishing a separate shim. The v1 npm package is `tip-verify`, and it installs a `tip-verify` binary.

## What Verification Means

`Verified` means the local tracked source tree produced the same Merkle root as a root published in the Ternoa registry for that subject, commit, and policy.

For Git-based subjects, the v1 policy hashes:

- Git-tracked source files
- file paths
- file modes
- file byte sizes
- SHA-256 file digests
- Git submodule pointers

The v1 policy does not hash runtime secrets, local config, caches, logs, memories, virtualenv dependencies, or untracked files.

## First Supported Integration: Hermes

Hermes support adds installer-aware discovery. After a user installs Hermes with:

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

they can run:

```bash
npx tip-verify verify --hermes
```

The CLI looks for Hermes in:

- `$HERMES_INSTALL_DIR`
- `$HERMES_HOME/hermes-agent`
- `~/.hermes/hermes-agent`
- `/usr/local/lib/hermes-agent`

It prints the package version from `pyproject.toml`, the Git commit, the local Merkle root, and the IPFS proof URI.

## What Happens on the Next Hermes Release?

When Hermes releases a new version or advances `main`, users who update immediately may briefly see:

```text
Not Verified
Installed: hermes-agent <new-version>
No TIP root found for git:github.com/NousResearch/hermes-agent at commit <new-commit>.
This installed version/commit is not currently registered as a verified Hermes build.
```

That means the local install may be legitimate, but TIP has not published that exact commit yet.

The indexer is designed to run hourly. On each run it:

1. fetches the upstream repository,
2. reads the latest `main` commit and newest tags,
3. generates manifests and roots,
4. pins manifest/metadata JSON to Pinata/IPFS,
5. publishes any missing roots on Ternoa.

Once the new release commit is indexed, the same user command becomes:

```text
Verified
Version: hermes-agent <new-version>
Commit: <new-commit>
```

For production use, `workers/hermes-cron` can run on Cloudflare every hour and trigger the GitHub Actions indexer as soon as a new supported release or `main` commit is detected. That avoids a confusing delay after upstream updates.

## Publishing New Roots

The current indexer lives in `indexer/` and is Hermes-specific for v1. It can publish:

- latest upstream `main`,
- latest tags,
- an explicit commit.

Examples:

```bash
node indexer/src/index.js --max-tags=3
node indexer/src/index.js --commit=<commit-sha>
```

Required publishing environment:

```bash
TIP_REGISTRY_ADDRESS=...
PUBLISHER_PRIVATE_KEY=...
PINATA_JWT=...
TERNOA_MAINNET_RPC_URL=https://rpc-mainnet.zkevm.ternoa.network/
```

The indexer also accepts `PINATA_JWT_SECRET`, `IPFS_API_TOKEN`, or `PINATA_API_KEY` plus `PINATA_API_SECRET`.

## Cloudflare Hourly Monitor

`workers/hermes-cron` is a Cloudflare Worker cron trigger. It runs hourly, checks the upstream Hermes `main` commit and latest tag through the GitHub API, deduplicates with KV, and dispatches `.github/workflows/publish-hermes-roots.yml` when a change is detected.

Required Worker secrets:

```bash
GITHUB_TOKEN=...
RUN_TOKEN=... # optional manual /run endpoint protection
```

Deployment outline:

```bash
cd workers/hermes-cron
npx wrangler kv namespace create TIP_VERIFY_STATE
# put the returned namespace id into wrangler.jsonc
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put RUN_TOKEN
npx wrangler deploy
```

## Adding More Integrations

To support another project, add:

- a subject ID, for example `git:github.com/org/repo`,
- a discovery adapter if it has an installer layout,
- a source/indexer target,
- optional version metadata extraction,
- any project-specific high-risk file labels.

The contract and manifest policy are already generic.

## NPM Publish

The npm package lives in `packages/cli`.

```bash
cd packages/cli
npm pack --dry-run
npm publish --access public
```

NPM versions are immutable. If `npm publish` reports `You cannot publish over the previously published versions`, bump `packages/cli/package.json` and publish again.

## Tests

```bash
node --test packages/core/test/*.test.js
forge test
```
