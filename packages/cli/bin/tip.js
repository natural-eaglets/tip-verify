#!/usr/bin/env node
let core;
try {
  core = await import("../src/core/index.js");
} catch {
  core = await import("../../core/src/index.js");
}

const {
  bytes32Id,
  classifyRisk,
  createGitManifest,
  DEFAULT_POLICY_ID,
  defaultHermesInstallPath,
  GitContextError,
  getDirtyTrackedFiles,
  hexToBytes,
  keccak256,
  policyId,
  resolveRepoContext,
  subjectId,
  versionId
} = core;

const DEFAULT_RPC = "https://rpc-mainnet.zkevm.ternoa.network/";
const DEFAULT_REGISTRY = "0x536625F6c65FBF7cC053Fb47ccc240aF9cF1bdFf";
const ZERO32 = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

function usage() {
  return `TIP Verify

Usage:
  tip-verify verify [--path <dir>] [--source <subject>] [--commit <sha>] [--policy <id>] [--hermes] [--json]
  tip-verify status <subject> [--policy <id>] [--json]
  tip-verify manifest [--path <dir>] [--source <subject>] [--commit <sha>] [--json]

Environment:
  TIP_REGISTRY_ADDRESS   Defaults to ${DEFAULT_REGISTRY}
  TERNOA_MAINNET_RPC_URL Defaults to ${DEFAULT_RPC}
`;
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "json" || key === "help" || key === "hermes") {
      flags[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    flags[key] = value;
    i += 1;
  }
  return { command: positional[0], positional: positional.slice(1), flags };
}

function pad32(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return clean.padStart(64, "0");
}

function encodeBytes32(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new Error(`Expected bytes32, got ${hex}`);
  return clean;
}

function selector(signature) {
  return keccak256(signature).slice(2, 10);
}

function encodeCall(signature, args) {
  return `0x${selector(signature)}${args.map(encodeBytes32).join("")}`;
}

function wordAt(data, slot) {
  const clean = data.startsWith("0x") ? data.slice(2) : data;
  return `0x${clean.slice(slot * 64, slot * 64 + 64)}`;
}

function decodeAddress(word) {
  return `0x${word.slice(-40)}`;
}

function decodeUint(word) {
  return Number.parseInt(word, 16);
}

function decodeBool(word) {
  return BigInt(word) !== 0n;
}

function decodeString(data, offsetBytes) {
  const clean = data.startsWith("0x") ? data.slice(2) : data;
  const offset = offsetBytes * 2;
  const len = Number.parseInt(clean.slice(offset, offset + 64), 16);
  const start = offset + 64;
  const hex = clean.slice(start, start + len * 2);
  return new TextDecoder().decode(hexToBytes(hex));
}

function decodeRootRecord(data) {
  if (!data || data === "0x") throw new Error("Empty eth_call response");
  const root = wordAt(data, 0);
  const manifestOffset = decodeUint(wordAt(data, 1));
  const metadataOffset = decodeUint(wordAt(data, 2));
  const publisher = decodeAddress(wordAt(data, 3));
  const timestamp = decodeUint(wordAt(data, 4));
  const revoked = decodeBool(wordAt(data, 5));
  return {
    root,
    manifestURI: decodeString(data, manifestOffset),
    metadataURI: decodeString(data, metadataOffset),
    publisher,
    timestamp,
    revoked
  };
}

function decodeLatestRecord(data) {
  if (!data || data === "0x") throw new Error("Empty eth_call response");
  const version = wordAt(data, 0);
  const root = wordAt(data, 1);
  const manifestOffset = decodeUint(wordAt(data, 2));
  const metadataOffset = decodeUint(wordAt(data, 3));
  const publisher = decodeAddress(wordAt(data, 4));
  const timestamp = decodeUint(wordAt(data, 5));
  const revoked = decodeBool(wordAt(data, 6));
  return {
    version,
    root,
    manifestURI: decodeString(data, manifestOffset),
    metadataURI: decodeString(data, metadataOffset),
    publisher,
    timestamp,
    revoked
  };
}

async function rpcCall(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

async function ethCall(address, data, rpcUrl) {
  return rpcCall(rpcUrl, "eth_call", [{ to: address, data }, "latest"]);
}

async function getRootRecord({ registry, rpcUrl, subject, version, policy }) {
  const data = encodeCall("getRoot(bytes32,bytes32,bytes32)", [
    subjectId(subject),
    versionId("commit", version),
    policyId(policy)
  ]);
  return decodeRootRecord(await ethCall(registry, data, rpcUrl));
}

async function getLatestRecord({ registry, rpcUrl, subject, policy }) {
  const data = encodeCall("getLatestRoot(bytes32,bytes32)", [
    subjectId(subject),
    policyId(policy)
  ]);
  return decodeLatestRecord(await ethCall(registry, data, rpcUrl));
}

function ipfsToHttp(uri) {
  if (!uri || !uri.startsWith("ipfs://")) return uri;
  const gateway = process.env.TIP_IPFS_GATEWAY_URL || "https://ipfs.io/ipfs/";
  return `${gateway.replace(/\/$/, "")}/${uri.slice("ipfs://".length)}`;
}

async function fetchJsonUri(uri) {
  if (!uri) return null;
  try {
    const response = await fetch(ipfsToHttp(uri), {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function formatPackage(manifestOrMetadata) {
  const name = manifestOrMetadata?.packageName;
  const version = manifestOrMetadata?.packageVersion;
  if (name && version) return `${name} ${version}`;
  if (version) return version;
  if (name) return name;
  return null;
}

function outputJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function registryConfig() {
  const registry = process.env.TIP_REGISTRY_ADDRESS || DEFAULT_REGISTRY;
  return {
    registry,
    rpcUrl: process.env.TERNOA_MAINNET_RPC_URL || DEFAULT_RPC
  };
}

async function commandManifest(flags) {
  const manifest = createGitManifest({
    path: flags.path || process.cwd(),
    source: flags.source,
    commit: flags.commit
  });
  if (flags.json) {
    outputJson(manifest);
    return 0;
  }
  console.log("TIP Manifest");
  console.log(`Subject: ${manifest.subject}`);
  const pkg = formatPackage(manifest);
  if (pkg) console.log(`Version: ${pkg}`);
  console.log(`Commit:  ${manifest.commit}`);
  console.log(`Policy:  ${manifest.policy}`);
  console.log(`Files:   ${manifest.fileCount}`);
  console.log(`Root:    ${manifest.root}`);
  return 0;
}

async function commandStatus(flags, positional) {
  const subject = positional[0];
  if (!subject) throw new Error("status requires a subject, e.g. github:NousResearch/hermes-agent");
  const normalizedSubject = subject.startsWith("git:") ? subject : `git:${subject.replace(/^github:/, "github.com/")}`;
  const policy = flags.policy || DEFAULT_POLICY_ID;
  const { registry, rpcUrl } = registryConfig();
  const latest = await getLatestRecord({ registry, rpcUrl, subject: normalizedSubject, policy });
  const latestMetadata = await fetchJsonUri(latest.metadataURI) || await fetchJsonUri(latest.manifestURI);
  const result = { subject: normalizedSubject, policy, registry, latest, latestMetadata };
  if (flags.json) {
    outputJson(result);
    return latest.root === ZERO32 ? 1 : 0;
  }
  console.log("TIP Status");
  console.log(`Subject: ${normalizedSubject}`);
  console.log(`Policy:  ${policy}`);
  if (latest.root === ZERO32 || latest.publisher === ZERO_ADDRESS) {
    console.log("Status:  No registered roots found");
    return 1;
  }
  console.log(`Latest:  ${latest.version}`);
  const pkg = formatPackage(latestMetadata);
  if (pkg) console.log(`Version: ${pkg}`);
  if (latestMetadata?.commit) console.log(`Commit:  ${latestMetadata.commit}`);
  else if (latestMetadata?.version) console.log(`Commit:  ${String(latestMetadata.version).replace(/^commit:/, "")}`);
  console.log(`Root:    ${latest.root}`);
  console.log(`URI:     ${latest.manifestURI || "(none)"}`);
  console.log(`Revoked: ${latest.revoked ? "yes" : "no"}`);
  return latest.revoked ? 1 : 0;
}

async function commandVerify(flags) {
  let repoPath = flags.path || process.cwd();
  let source = flags.source;
  if (flags.hermes) {
    const hermesPath = defaultHermesInstallPath();
    if (!hermesPath) {
      console.log("Not Verified");
      console.log("No Hermes install was found at $HERMES_INSTALL_DIR, $HERMES_HOME/hermes-agent, or /usr/local/lib/hermes-agent.");
      return 1;
    }
    repoPath = hermesPath;
    source ||= "github:NousResearch/hermes-agent";
  }
  let context;
  try {
    context = resolveRepoContext(repoPath, source, flags.commit);
  } catch (error) {
    if (error instanceof GitContextError) {
      const hermesPath = defaultHermesInstallPath();
      if (!flags.path && !flags.hermes && hermesPath) {
        repoPath = hermesPath;
        source ||= "github:NousResearch/hermes-agent";
        context = resolveRepoContext(repoPath, source, flags.commit);
      } else {
      if (flags.json) {
        outputJson({
          status: "git_context_error",
          code: error.details?.code,
          message: error.message
        });
      } else {
        console.log("Not Verified");
        console.log(error.message);
        if (error.details?.code === "missing_origin") {
          console.log("This checkout does not have an `origin` remote, so TIP cannot infer the on-chain subject.");
          console.log("Run one of:");
          console.log("  git remote add origin https://github.com/NousResearch/hermes-agent.git");
          console.log("  tip verify --source github:NousResearch/hermes-agent");
        } else if (error.details?.code === "not_git_repo") {
          console.log("Run this command inside a Git checkout, or pass --path /path/to/repo.");
        } else if (error.details?.code === "missing_head") {
          console.log("The repository has no HEAD commit yet.");
        }
      }
      return 1;
      }
    }
    if (!context) throw error;
  }
  const manifest = createGitManifest({
    path: repoPath,
    source: context.subject,
    commit: context.commit
  });
  const policy = flags.policy || DEFAULT_POLICY_ID;
  const { registry, rpcUrl } = registryConfig();
  const remote = await getRootRecord({
    registry,
    rpcUrl,
    subject: context.subject,
    version: context.commit,
    policy
  });
  const dirty = getDirtyTrackedFiles(context.root).map((path) => ({
    path,
    risk: classifyRisk(path)
  }));

  const result = {
    subject: context.subject,
    commit: context.commit,
    packageName: manifest.packageName,
    packageVersion: manifest.packageVersion,
    policy,
    localRoot: manifest.root,
    remote,
    dirty,
    verified: remote.root === manifest.root && !remote.revoked && remote.root !== ZERO32
  };

  if (remote.root === ZERO32 || remote.publisher === ZERO_ADDRESS) {
    let latest = null;
    try {
      latest = await getLatestRecord({ registry, rpcUrl, subject: context.subject, policy });
      result.latest = latest;
    } catch {
      // Best-effort hint only.
    }
    if (flags.json) outputJson({ ...result, status: "not_found" });
    else {
      console.log("Not Verified");
      const pkg = formatPackage(manifest);
      if (pkg) console.log(`Installed: ${pkg}`);
      console.log(`No TIP root found for ${context.subject} at commit ${context.commit}.`);
      console.log("This installed version/commit is not currently registered as a verified Hermes build.");
      console.log("Possible reasons: the commit has not been indexed yet, the install is older/newer than the registry, this is a fork/private branch, or the policy differs.");
      if (latest && latest.root !== ZERO32) {
        const latestMetadata = await fetchJsonUri(latest.metadataURI) || await fetchJsonUri(latest.manifestURI);
        const latestPkg = formatPackage(latestMetadata);
        if (latestPkg) console.log(`Latest registered version: ${latestPkg}`);
        if (latestMetadata?.commit) console.log(`Latest registered commit:  ${latestMetadata.commit}`);
        else if (latestMetadata?.version) console.log(`Latest registered commit:  ${String(latestMetadata.version).replace(/^commit:/, "")}`);
        else console.log(`Latest known version: ${latest.version}`);
      }
    }
    return 1;
  }

  if (remote.revoked) {
    if (flags.json) outputJson({ ...result, status: "revoked" });
    else {
      console.log("Not Verified");
      const pkg = formatPackage(manifest);
      if (pkg) console.log(`Installed: ${pkg}`);
      console.log("The matching on-chain root has been revoked.");
      console.log(`Manifest: ${remote.manifestURI || "(none)"}`);
    }
    return 1;
  }

  if (remote.root !== manifest.root) {
    if (flags.json) outputJson({ ...result, status: "mismatch" });
    else {
      console.log("Not Verified");
      const pkg = formatPackage(manifest);
      if (pkg) console.log(`Installed: ${pkg}`);
      console.log(`Local root:  ${manifest.root}`);
      console.log(`Remote root: ${remote.root}`);
      if (dirty.length > 0) {
        console.log("Changed tracked files:");
        for (const file of dirty.slice(0, 25)) console.log(`- [${file.risk}] ${file.path}`);
        if (dirty.length > 25) console.log(`...and ${dirty.length - 25} more`);
      } else {
        console.log("No dirty tracked files detected; the local checkout may be on a different tree than the registered source.");
      }
    }
    return 1;
  }

  if (flags.json) outputJson({ ...result, status: "verified" });
  else {
    console.log("Verified");
    console.log(`Subject: ${context.subject}`);
    const pkg = formatPackage(manifest);
    if (pkg) console.log(`Version: ${pkg}`);
    console.log(`Commit:  ${context.commit}`);
    console.log(`Root:    ${manifest.root}`);
    console.log(`Proof:   ${remote.manifestURI || "(manifest URI unavailable)"}`);
    if (dirty.length > 0) {
      console.log(`Note: ${dirty.length} tracked local change(s) are present but did not affect the checked commit root.`);
    }
  }
  return 0;
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (!command || flags.help) {
    console.log(usage());
    return 0;
  }
  if (command === "manifest") return commandManifest(flags);
  if (command === "verify") return commandVerify(flags);
  if (command === "status") return commandStatus(flags, positional);
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`TIP error: ${error.message}`);
    process.exitCode = 2;
  });
