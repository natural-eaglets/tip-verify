import { config as dotenvConfig } from "dotenv";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";

dotenvConfig();

const privateKey = process.env.DEPLOYER_PRIVATE_KEY || "";

export default {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: "paris"
    }
  },
  networks: {
    ternoaMainnet: {
      url: process.env.TERNOA_MAINNET_RPC_URL || "https://rpc-mainnet.zkevm.ternoa.network/",
      chainId: 752025,
      accounts: privateKey ? [privateKey] : []
    }
  },
  sourcify: {
    enabled: false
  }
};
