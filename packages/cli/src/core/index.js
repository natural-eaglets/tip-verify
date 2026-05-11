import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { relative, resolve } from "node:path";

export const DEFAULT_POLICY_ID = "tip.git.tracked-source.v1";
export const DEFAULT_SCHEMA = "tip.manifest.v1";

const MASK_64 = (1n << 64n) - 1n;
const KECCAK_ROUNDS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];
const RHO = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14]
];

export function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`Invalid hex length: ${hex}`);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes) {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function rotl64(value, shift) {
  const s = BigInt(shift % 64);
  if (s === 0n) return value & MASK_64;
  return ((value << s) | (value >> (64n - s))) & MASK_64;
}

function keccakF1600(state) {
  for (const rc of KECCAK_ROUNDS) {
    const c = new Array(5).fill(0n);
    const d = new Array(5).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (state[x + 5 * y] ^ d[x]) & MASK_64;
      }
    }

    const b = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const nx = y;
        const ny = (2 * x + 3 * y) % 5;
        b[nx + 5 * ny] = rotl64(state[x + 5 * y], RHO[x][y]);
      }
    }

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y]) & b[((x + 2) % 5) + 5 * y])) & MASK_64;
      }
    }
    state[0] = (state[0] ^ rc) & MASK_64;
  }
}

export function keccak256(input) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input;
  const rate = 136;
  const state = new Array(25).fill(0n);
  const block = new Uint8Array(rate);
  let offset = 0;

  while (offset + rate <= bytes.length) {
    for (let i = 0; i < rate / 8; i += 1) {
      let lane = 0n;
      for (let j = 0; j < 8; j += 1) lane |= BigInt(bytes[offset + i * 8 + j]) << BigInt(8 * j);
      state[i] ^= lane;
    }
    keccakF1600(state);
    offset += rate;
  }

  block.set(bytes.slice(offset));
  block[bytes.length - offset] ^= 0x01;
  block[rate - 1] ^= 0x80;
  for (let i = 0; i < rate / 8; i += 1) {
    let lane = 0n;
    for (let j = 0; j < 8; j += 1) lane |= BigInt(block[i * 8 + j]) << BigInt(8 * j);
    state[i] ^= lane;
  }
  keccakF1600(state);

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    const lane = state[i];
    for (let j = 0; j < 8; j += 1) out[i * 8 + j] = Number((lane >> BigInt(8 * j)) & 0xffn);
  }
  return bytesToHex(out);
}

export function sha256Hex(bytes) {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

export function bytes32Id(value) {
  return keccak256(value);
}

export function subjectId(subject) {
  return bytes32Id(subject);
}

export function versionId(kind, value) {
  return bytes32Id(`${kind}:${value}`);
}

export function policyId(policy = DEFAULT_POLICY_ID) {
  return bytes32Id(policy);
}

export function execGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export class GitContextError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GitContextError";
    this.details = details;
  }
}

function tryExecGit(args, cwd) {
  try {
    return execGit(args, cwd);
  } catch (error) {
    return null;
  }
}

export function normalizeGitRemote(remote) {
  const clean = remote.trim().replace(/\.git$/, "");
  if (clean.startsWith("github:")) return `git:github.com/${clean.slice("github:".length)}`;
  if (clean.startsWith("git:")) return clean;
  if (clean.startsWith("github.com/")) return `git:${clean}`;
  const ssh = clean.match(/^git@([^:]+):(.+)$/);
  if (ssh) return `git:${ssh[1].toLowerCase()}/${ssh[2]}`;
  try {
    const url = new URL(clean);
    return `git:${url.hostname.toLowerCase()}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return clean;
  }
}

export function resolveRepoContext(repoPath = process.cwd(), sourceOverride, commitOverride) {
  const root = tryExecGit(["rev-parse", "--show-toplevel"], repoPath);
  if (!root) {
    throw new GitContextError(`Not a Git repository: ${repoPath}`, {
      code: "not_git_repo",
      repoPath
    });
  }
  const commit = commitOverride || tryExecGit(["rev-parse", "HEAD"], root);
  if (!commit) {
    throw new GitContextError(`Unable to resolve HEAD in ${root}`, {
      code: "missing_head",
      repoPath: root
    });
  }
  const remote = sourceOverride ? null : tryExecGit(["remote", "get-url", "origin"], root);
  if (!sourceOverride && !remote) {
    throw new GitContextError(`Git repository has no origin remote: ${root}`, {
      code: "missing_origin",
      repoPath: root
    });
  }
  const subject = sourceOverride ? normalizeGitRemote(sourceOverride) : normalizeGitRemote(remote);
  return { root, commit, subject };
}

export function defaultHermesInstallPath() {
  const home = process.env.HOME;
  if (!home) return null;
  const hermesHome = process.env.HERMES_HOME || `${home}/.hermes`;
  const candidates = [
    process.env.HERMES_INSTALL_DIR,
    `${hermesHome}/hermes-agent`,
    "/usr/local/lib/hermes-agent"
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(`${candidate}/.git`)) || null;
}

export function readProjectMetadata(repoRoot) {
  const pyprojectPath = resolve(repoRoot, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    const text = readFileSync(pyprojectPath, "utf8");
    const projectBlock = text.match(/^\[project\]\s*([\s\S]*?)(?:^\[|\z)/m)?.[1] || text;
    const name = projectBlock.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const version = projectBlock.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
    if (name || version) return { name, version, source: "pyproject.toml" };
  }

  const packageJsonPath = resolve(repoRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const json = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (json.name || json.version) return { name: json.name, version: json.version, source: "package.json" };
    } catch {
      // Ignore invalid package metadata; integrity verification should continue.
    }
  }

  return { name: null, version: null, source: null };
}

export function shouldExcludeTrackedPath(path) {
  const normalized = path.replaceAll("\\", "/");
  return [
    /^\.env($|\.)/,
    /(^|\/)\.env($|\.)/,
    /(^|\/)node_modules\//,
    /(^|\/)\.venv\//,
    /(^|\/)venv\//,
    /(^|\/)__pycache__\//,
    /(^|\/)\.pytest_cache\//,
    /(^|\/)\.mypy_cache\//,
    /(^|\/)\.ruff_cache\//,
    /(^|\/)\.cache\//,
    /(^|\/)dist\//,
    /(^|\/)build\//,
    /(^|\/)out\//,
    /(^|\/)coverage\//,
    /(^|\/)\.hermes\//,
    /(^|\/)memories\//,
    /(^|\/)MEMORY\.md$/,
    /(^|\/)USER\.md$/
  ].some((pattern) => pattern.test(normalized));
}

export function listTrackedFiles(repoRoot) {
  const raw = execFileSync("git", ["ls-files", "-z", "-s"], {
    cwd: repoRoot,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+([0-9a-f]{40,64})\s+\d+\t(.+)$/);
      if (!match) throw new Error(`Unable to parse git ls-files row: ${line}`);
      return { mode: match[1], oid: match[2], path: match[3] };
    })
    .filter((entry) => !shouldExcludeTrackedPath(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path, "en", { sensitivity: "variant" }));
}

export function hashTrackedFile(repoRoot, entry) {
  if (entry.mode === "160000") {
    const bytes = Buffer.from(entry.oid, "utf8");
    return {
      path: entry.path.replaceAll("\\", "/"),
      mode: entry.mode,
      size: bytes.length,
      sha256: sha256Hex(bytes),
      gitObject: entry.oid
    };
  }
  const fullPath = resolve(repoRoot, entry.path);
  const stat = lstatSync(fullPath);
  const bytes = stat.isSymbolicLink()
    ? Buffer.from(readlinkSync(fullPath), "utf8")
    : readFileSync(fullPath);
  return {
    path: entry.path.replaceAll("\\", "/"),
    mode: entry.mode,
    size: bytes.length,
    sha256: sha256Hex(bytes)
  };
}

export function stableFileJson(file) {
  return JSON.stringify({
    path: file.path,
    mode: file.mode,
    size: file.size,
    sha256: file.sha256
  });
}

export function merkleRoot(files) {
  if (files.length === 0) return keccak256("tip.empty");
  let level = files.map((file) => keccak256(`tip.leaf.v1:${stableFileJson(file)}`));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = hexToBytes(level[i]);
      const right = hexToBytes(level[i + 1] || level[i]);
      const combined = new Uint8Array(left.length + right.length);
      combined.set(left);
      combined.set(right, left.length);
      next.push(keccak256(combined));
    }
    level = next;
  }
  return level[0];
}

export function createGitManifest(options = {}) {
  const repoPath = resolve(options.path || process.cwd());
  const context = resolveRepoContext(repoPath, options.source, options.commit);
  const tracked = listTrackedFiles(context.root);
  const files = tracked.map((entry) => hashTrackedFile(context.root, entry));
  const root = merkleRoot(files);
  const project = readProjectMetadata(context.root);
  return {
    schema: DEFAULT_SCHEMA,
    policy: DEFAULT_POLICY_ID,
    subject: context.subject,
    packageName: project.name,
    packageVersion: project.version,
    packageMetadataSource: project.source,
    commit: context.commit,
    version: `commit:${context.commit}`,
    root,
    files,
    fileCount: files.length
  };
}

export function getDirtyTrackedFiles(repoRoot) {
  const porcelain = tryExecGit(["status", "--porcelain=v1", "--untracked-files=no"], repoRoot);
  if (!porcelain) return [];
  return porcelain
    .split("\n")
    .map((line) => {
      const match = line.match(/^(?:..|.)\s+(.+)$/);
      return (match?.[1] || line).trim();
    })
    .filter(Boolean);
}

export function classifyRisk(path) {
  const high = [
    /^run_agent\.py$/,
    /^cli\.py$/,
    /^hermes_bootstrap\.py$/,
    /^scripts\/install/,
    /^scripts\/.*install/,
    /^agent\/tools\//,
    /^gateway\//,
    /^hermes_cli\//,
    /^mcp/,
    /auth/i,
    /secret/i,
    /credential/i,
    /shell/i,
    /subprocess/i
  ];
  return high.some((pattern) => pattern.test(path)) ? "high-risk" : "modified";
}

export function repoRelativePath(repoRoot, path) {
  return relative(repoRoot, resolve(path)).replaceAll("\\", "/");
}
