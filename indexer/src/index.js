#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createGitManifest,
  DEFAULT_POLICY_ID,
  policyId,
  subjectId,
  versionId
} from "../../packages/core/src/index.js";

const HERMES_REPO = "https://github.com/NousResearch/hermes-agent.git";
const HERMES_SUBJECT = "git:github.com/NousResearch/hermes-agent";
const DEFAULT_RPC = "https://rpc-mainnet.zkevm.ternoa.network/";

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    maxTags: Number(argv.find((arg) => arg.startsWith("--max-tags="))?.split("=")[1] || 3),
    commit: argv.find((arg) => arg.startsWith("--commit="))?.split("=")[1],
    cacheDir: argv.find((arg) => arg.startsWith("--cache-dir="))?.split("=")[1] || ".tip-cache"
  };
}

function run(command, args, options = {}) {
  const result = execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    ...options
  });
  return typeof result === "string" ? result.trim() : "";
}

function git(args, cwd) {
  return run("git", args, { cwd });
}

function ensureHermesRepo(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const repoPath = resolve(cacheDir, "hermes-agent");
  if (!existsSync(resolve(repoPath, ".git"))) {
    run("git", ["clone", "--filter=blob:none", HERMES_REPO, repoPath], { inherit: true });
  }
  git(["fetch", "--tags", "origin", "main"], repoPath);
  return repoPath;
}

function collectTargets(repoPath, maxTags, commit) {
  if (commit) {
    git(["cat-file", "-e", `${commit}^{commit}`], repoPath);
    return [{
      label: `commit:${commit}`,
      checkout: commit,
      versionKind: "commit",
      versionValue: commit,
      metadata: { commit }
    }];
  }
  const mainCommit = git(["rev-parse", "origin/main"], repoPath);
  const tags = git(["tag", "--sort=-creatordate"], repoPath)
    .split("\n")
    .filter(Boolean)
    .slice(0, maxTags)
    .map((tag) => ({
      label: `tag:${tag}`,
      checkout: tag,
      versionKind: "commit",
      versionValue: git(["rev-list", "-n", "1", tag], repoPath),
      metadata: { tag }
    }));
  return [
    {
      label: "main",
      checkout: mainCommit,
      versionKind: "commit",
      versionValue: mainCommit,
      metadata: { branch: "main" }
    },
    ...tags
  ];
}

async function uploadJsonToIpfs(manifest) {
  if (hasPinataCredentials()) {
    return uploadToPinata(manifest);
  }
  const apiUrl = process.env.IPFS_API_URL;
  if (!apiUrl) throw new Error("Pinata credentials are required for publishing. Set PINATA_JWT or PINATA_API_KEY/PINATA_SECRET_API_KEY.");
  const host = new URL(apiUrl).hostname;
  if (host === "127.0.0.1" || host === "localhost") {
    throw new Error("Refusing to publish with a localhost IPFS endpoint. Use Pinata credentials for production publishing.");
  }
  const body = new FormData();
  body.append("file", new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }), "manifest.json");
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v0/add?pin=true`, {
    method: "POST",
    headers: process.env.IPFS_API_TOKEN ? { authorization: `Bearer ${process.env.IPFS_API_TOKEN}` } : {},
    body
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`IPFS upload failed: ${text}`);
  const json = JSON.parse(text.trim().split("\n").at(-1));
  if (!json.Hash) throw new Error(`IPFS response did not include Hash: ${text}`);
  return `ipfs://${json.Hash}`;
}

async function uploadToPinata(payload) {
  const body = new FormData();
  body.append("file", new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "manifest.json");
  body.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  const jwt = pinataJwt();
  const apiKey = pinataApiKey();
  const secretApiKey = pinataSecretApiKey();
  const headers = jwt
    ? { authorization: `Bearer ${jwt}` }
    : {
        pinata_api_key: apiKey,
        pinata_secret_api_key: secretApiKey
      };
  const endpoint = pinataEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Pinata upload failed: ${text}`);
  const json = JSON.parse(text);
  if (!json.IpfsHash) throw new Error(`Pinata response did not include IpfsHash: ${text}`);
  return `ipfs://${json.IpfsHash}`;
}

function hasPinataCredentials() {
  return Boolean(
    pinataJwt() ||
    (pinataApiKey() && pinataSecretApiKey())
  );
}

function pinataJwt() {
  return process.env.PINATA_JWT || process.env.PINATA_JWT_SECRET || process.env.IPFS_API_TOKEN;
}

function pinataApiKey() {
  return process.env.PINATA_API_KEY || process.env.INATA_API_KEY;
}

function pinataSecretApiKey() {
  return process.env.PINATA_SECRET_API_KEY || process.env.PINATA_API_SECRET;
}

function pinataEndpoint() {
  const configured = process.env.PINATA_API_URL || process.env.IPFS_API_URL;
  if (configured && configured.includes("api.pinata.cloud")) {
    if (configured.includes("/pinning/pinFileToIPFS")) return configured;
    return `${configured.replace(/\/$/, "")}/pinning/pinFileToIPFS`;
  }
  return "https://api.pinata.cloud/pinning/pinFileToIPFS";
}

function castCall(signature, args) {
  return run("cast", [
    "call",
    process.env.TIP_REGISTRY_ADDRESS,
    signature,
    ...args,
    "--rpc-url",
    process.env.TERNOA_MAINNET_RPC_URL || DEFAULT_RPC
  ]);
}

function castSend(signature, args) {
  const output = run("cast", [
    "send",
    process.env.TIP_REGISTRY_ADDRESS,
    signature,
    ...args,
    "--legacy",
    "--gas-limit",
    process.env.TIP_PUBLISH_GAS_LIMIT || "1000000",
    "--rpc-url",
    process.env.TERNOA_MAINNET_RPC_URL || DEFAULT_RPC,
    "--private-key",
    process.env.PUBLISHER_PRIVATE_KEY
  ]);
  console.log(output);
  if (!/status\s+1 \(success\)/.test(output)) {
    throw new Error("On-chain publish transaction failed; receipt did not report status 1.");
  }
}

function ensurePublisherEnv() {
  for (const name of ["TIP_REGISTRY_ADDRESS", "PUBLISHER_PRIVATE_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is required when not running --dry-run.`);
  }
  if (!hasPinataCredentials()) {
    throw new Error("Set PINATA_JWT, PINATA_JWT_SECRET, IPFS_API_TOKEN, or PINATA_API_KEY/PINATA_SECRET_API_KEY before publishing.");
  }
}

function hasRoot(target) {
  const result = castCall(
    "hasRoot(bytes32,bytes32,bytes32)(bool)",
    [
      subjectId(HERMES_SUBJECT),
      versionId(target.versionKind, target.versionValue),
      policyId(DEFAULT_POLICY_ID)
    ]
  );
  return result.includes("true");
}

async function publishTarget(repoPath, target, options) {
  git(["checkout", "--quiet", target.checkout], repoPath);
  const manifest = createGitManifest({
    path: repoPath,
    source: HERMES_SUBJECT,
    commit: target.versionValue
  });
  const metadata = {
    subject: HERMES_SUBJECT,
    target: target.label,
    version: `${target.versionKind}:${target.versionValue}`,
    packageName: manifest.packageName,
    packageVersion: manifest.packageVersion,
    packageMetadataSource: manifest.packageMetadataSource,
    commit: target.versionValue,
    policy: DEFAULT_POLICY_ID,
    root: manifest.root,
    generatedAt: new Date().toISOString(),
    ...target.metadata
  };
  mkdirSync(resolve(options.cacheDir, "manifests"), { recursive: true });
  writeFileSync(
    resolve(options.cacheDir, "manifests", `${target.versionValue}.json`),
    JSON.stringify({ manifest, metadata }, null, 2)
  );

  if (options.dryRun) {
    console.log(`[dry-run] ${target.label} ${target.versionValue} ${manifest.root}`);
    return;
  }

  ensurePublisherEnv();
  if (hasRoot(target)) {
    console.log(`[skip] ${target.label} ${target.versionValue} already registered`);
    return;
  }

  const manifestURI = await uploadJsonToIpfs(manifest);
  const metadataURI = await uploadJsonToIpfs(metadata);
  castSend(
    "publishRoot(bytes32,bytes32,bytes32,bytes32,string,string)",
    [
      subjectId(HERMES_SUBJECT),
      versionId(target.versionKind, target.versionValue),
      policyId(DEFAULT_POLICY_ID),
      manifest.root,
      manifestURI,
      metadataURI
    ]
  );
  console.log(`[published] ${target.label} ${target.versionValue} ${manifest.root}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoPath = ensureHermesRepo(options.cacheDir);
  const targets = collectTargets(repoPath, options.maxTags, options.commit);
  for (const target of targets) {
    await publishTarget(repoPath, target, options);
  }
}

main().catch((error) => {
  console.error(`Indexer error: ${error.message}`);
  process.exitCode = 1;
});
