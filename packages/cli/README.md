# tip-verify

Verify local software source trees against integrity roots published on Ternoa zkEVM.

Hermes Agent is the first supported integration, but the CLI and registry model are generic.

## Quick Start

Verify a generic Git checkout:

```bash
npx tip-verify verify --path ./repo --source github:owner/repo
```

Verify a Hermes install created by the official installer:

```bash
npx tip-verify verify --hermes
```

Check the latest registered root:

```bash
npx tip-verify status github:NousResearch/hermes-agent
```

Generate a local manifest without reading the chain:

```bash
npx tip-verify manifest --path ./repo
```

## Configuration

The package has the v1 registry address built in. Override only when needed:

```bash
export TIP_REGISTRY_ADDRESS=0x536625F6c65FBF7cC053Fb47ccc240aF9cF1bdFf
export TERNOA_MAINNET_RPC_URL=https://rpc-mainnet.zkevm.ternoa.network/
```

## Commands

```bash
tip-verify verify [--path <dir>] [--source <subject>] [--commit <sha>] [--policy <id>] [--hermes] [--json]
tip-verify status <subject> [--policy <id>] [--json]
tip-verify manifest [--path <dir>] [--source <subject>] [--commit <sha>] [--json]
```

## Exit Codes

- `0`: verified
- `1`: not verified, missing root, mismatch, or revoked root
- `2`: tool, config, network, or RPC error

## What Gets Hashed

The v1 Git policy hashes tracked source files only. It excludes local-only files such as `.git`, `.env`, caches, virtualenvs, `node_modules`, logs, memories, and untracked files.

The manifest includes each file path, Git mode, byte size, and SHA-256 digest. The final Merkle root is stored on-chain.

Package version text is informational. The security decision is made from the subject, commit, policy, and Merkle root.

## Hermes Release Behavior

When Hermes publishes a new version or advances `main`, an updated install may briefly show `Not Verified` until TIP publishes that exact commit. This is expected: the verifier only accepts commits already registered on-chain.

Once the indexer publishes the new commit, the same command returns `Verified`.

## Troubleshooting

If a generic checkout has no `origin` remote, either add one:

```bash
git remote add origin https://github.com/owner/repo.git
```

or pass the source explicitly:

```bash
npx tip-verify verify --source github:owner/repo
```

Dirty-file reporting is best-effort. Any listed tracked-file edit means verification failed; labels such as `high-risk` only prioritize what to inspect first.

## Registry

- Chain: Ternoa zkEVM mainnet
- Chain ID: `752025`
- Registry: `0x536625F6c65FBF7cC053Fb47ccc240aF9cF1bdFf`
- Explorer: `https://explorer-mainnet.zkevm.ternoa.network/address/0x536625f6c65fbf7cc053fb47ccc240af9cf1bdff`
