#!/usr/bin/env bash
set -euo pipefail

: "${TIP_REGISTRY_ADDRESS:?TIP_REGISTRY_ADDRESS is required}"
: "${OWNER_ADDRESS:?OWNER_ADDRESS used in the constructor is required}"

echo "Verify TipRegistry at $TIP_REGISTRY_ADDRESS on the Ternoa zkEVM explorer."
echo "If the explorer supports Foundry verification, run:"
echo
echo "forge verify-contract \\"
echo "  --chain-id 752025 \\"
echo "  --constructor-args \$(cast abi-encode 'constructor(address)' \"$OWNER_ADDRESS\") \\"
echo "  \"$TIP_REGISTRY_ADDRESS\" \\"
echo "  contracts/src/TipRegistry.sol:TipRegistry"
echo
echo "Explorer: https://explorer-mainnet.zkevm.ternoa.network/"
