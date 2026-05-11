# TIP Verify Operations

## Deploy Registry

Set the deployer key and deploy to Ternoa zkEVM mainnet:

```bash
export TERNOA_MAINNET_RPC_URL=https://rpc-mainnet.zkevm.ternoa.network/
export DEPLOYER_PRIVATE_KEY=...
./scripts/deploy-mainnet.sh
```

Save the deployed address as `TIP_REGISTRY_ADDRESS`.

## Configure Publisher

The deployer is a publisher by default. For a separate publisher account:

```bash
cast send "$TIP_REGISTRY_ADDRESS" \
  "setPublisher(address,bool)" "$PUBLISHER_ADDRESS" true \
  --rpc-url "$TERNOA_MAINNET_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

## Publish Hermes Roots

Dry-run:

```bash
node indexer/src/index.js --dry-run
```

Publish:

```bash
export TIP_REGISTRY_ADDRESS=...
export PUBLISHER_PRIVATE_KEY=...
export PINATA_JWT=...
node indexer/src/index.js
```

Production publishing uses Pinata's `pinFileToIPFS` endpoint. Set either `PINATA_JWT`, `PINATA_JWT_SECRET`, `IPFS_API_TOKEN` as a JWT alias, or `PINATA_API_KEY` plus `PINATA_SECRET_API_KEY`. The indexer also accepts `PINATA_API_SECRET` as the secret-key alias. `IPFS_API_URL` may point to `https://api.pinata.cloud`, but localhost endpoints are rejected for real publishing.

The GitHub workflow `.github/workflows/publish-hermes-roots.yml` runs twice daily at `00:17` and `12:17` UTC.

## Verify Locally

From a Hermes checkout:

```bash
npx tip-verify verify
```

For local development from this repository:

```bash
node packages/cli/bin/tip.js verify --path /path/to/hermes-agent
```
