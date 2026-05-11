import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  classifyRisk,
  createGitManifest,
  getDirtyTrackedFiles,
  keccak256,
  merkleRoot,
  normalizeGitRemote
} from "../src/index.js";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tip-core-"));
  git(["init"], dir);
  git(["config", "user.email", "tip@example.test"], dir);
  git(["config", "user.name", "TIP Test"], dir);
  git(["remote", "add", "origin", "https://github.com/NousResearch/hermes-agent.git"], dir);
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# Demo\n");
  writeFileSync(join(dir, "agent", "main.py"), "print('hello')\n");
  git(["add", "."], dir);
  git(["commit", "-m", "init"], dir);
  return dir;
}

test("keccak256 matches Ethereum empty string vector", () => {
  assert.equal(
    keccak256(""),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
});

test("normalizes common GitHub remotes", () => {
  assert.equal(
    normalizeGitRemote("https://github.com/NousResearch/hermes-agent.git"),
    "git:github.com/NousResearch/hermes-agent"
  );
  assert.equal(
    normalizeGitRemote("git@github.com:NousResearch/hermes-agent.git"),
    "git:github.com/NousResearch/hermes-agent"
  );
  assert.equal(
    normalizeGitRemote("github:NousResearch/hermes-agent"),
    "git:github.com/NousResearch/hermes-agent"
  );
  assert.equal(
    normalizeGitRemote("github.com/NousResearch/hermes-agent"),
    "git:github.com/NousResearch/hermes-agent"
  );
});

test("manifest root is stable across repeated runs", () => {
  const dir = fixtureRepo();
  const first = createGitManifest({ path: dir });
  const second = createGitManifest({ path: dir });
  assert.equal(first.root, second.root);
  assert.equal(first.fileCount, 2);
});

test("untracked local files do not affect manifest root", () => {
  const dir = fixtureRepo();
  const first = createGitManifest({ path: dir });
  writeFileSync(join(dir, ".env"), "SECRET=1\n");
  writeFileSync(join(dir, "local.tmp"), "noise\n");
  const second = createGitManifest({ path: dir });
  assert.equal(first.root, second.root);
});

test("file mode changes affect manifest root", () => {
  const dir = fixtureRepo();
  const first = createGitManifest({ path: dir });
  chmodSync(join(dir, "agent", "main.py"), 0o755);
  git(["add", "agent/main.py"], dir);
  const second = createGitManifest({ path: dir });
  assert.notEqual(first.root, second.root);
});

test("dirty tracked file reporting preserves full path", () => {
  const dir = fixtureRepo();
  writeFileSync(join(dir, "agent", "main.py"), "print('tampered')\n");
  assert.deepEqual(getDirtyTrackedFiles(dir), ["agent/main.py"]);
});

test("risk labels do not call source edits normal", () => {
  assert.equal(classifyRisk("run_agent.py"), "high-risk");
  assert.equal(classifyRisk("README.md"), "modified");
});

test("Merkle root respects path order via caller-sorted files", () => {
  const files = [
    { path: "a", mode: "100644", size: 1, sha256: "0x01" },
    { path: "b", mode: "100644", size: 1, sha256: "0x02" }
  ];
  assert.equal(merkleRoot(files), merkleRoot([...files]));
  assert.notEqual(merkleRoot(files), merkleRoot([...files].reverse()));
});
