#!/usr/bin/env bash
set -euo pipefail

: "${TERNOA_MAINNET_RPC_URL:=https://rpc-mainnet.zkevm.ternoa.network/}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"

OWNER_ADDRESS="${OWNER_ADDRESS:-$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")}"

forge create \
  --broadcast \
  --legacy \
  --rpc-url "$TERNOA_MAINNET_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  contracts/src/TipRegistry.sol:TipRegistry \
  --constructor-args "$OWNER_ADDRESS"
