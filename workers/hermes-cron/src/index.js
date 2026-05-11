const GITHUB_API = "https://api.github.com";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, service: "tip-verify-hermes-cron" });
    }

    if (url.pathname === "/run") {
      const expected = env.RUN_TOKEN;
      if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const result = await checkAndDispatch(env, "manual");
      return json(result, result.ok ? 200 : 500);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      checkAndDispatch(env, controller.cron)
        .then((result) => console.log("scheduled result", JSON.stringify(result)))
        .catch((error) => {
          console.error("scheduled failed", error?.stack || error?.message || String(error));
          throw error;
        })
    );
  }
};

async function checkAndDispatch(env, trigger) {
  assertEnv(env, ["STATE", "GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_WORKFLOW_FILE", "GITHUB_WORKFLOW_REF", "HERMES_REPO"]);

  const latest = await fetchHermesLatest(env);
  const stateKey = `hermes:${latest.repo}`;
  const previous = await env.STATE.get(stateKey, "json");

  const changed = !previous ||
    previous.mainSha !== latest.mainSha ||
    previous.latestTagName !== latest.latestTagName ||
    previous.latestTagSha !== latest.latestTagSha;

  if (!changed) {
    return { ok: true, trigger, changed: false, latest };
  }

  const dispatch = await dispatchIndexer(env, latest);
  await env.STATE.put(stateKey, JSON.stringify({
    ...latest,
    dispatchedAt: new Date().toISOString(),
    dispatch
  }));

  return { ok: true, trigger, changed: true, latest, dispatch };
}

async function fetchHermesLatest(env) {
  const repo = env.HERMES_REPO;
  const main = await githubJson(`/repos/${repo}/commits/main`, env.GITHUB_TOKEN);
  const tags = await githubJson(`/repos/${repo}/tags?per_page=1`, env.GITHUB_TOKEN);
  const latestTag = Array.isArray(tags) && tags.length > 0 ? tags[0] : null;

  return {
    repo,
    mainSha: main.sha,
    latestTagName: latestTag?.name || null,
    latestTagSha: latestTag?.commit?.sha || null,
    checkedAt: new Date().toISOString()
  };
}

async function dispatchIndexer(env, latest) {
  const path = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_FILE}/dispatches`;
  const response = await githubFetch(path, env.GITHUB_TOKEN, {
    method: "POST",
    body: JSON.stringify({
      ref: env.GITHUB_WORKFLOW_REF,
      inputs: {
        dry_run: "false"
      }
    })
  });

  if (response.status !== 204) {
    const text = await response.text();
    throw new Error(`GitHub workflow dispatch failed: ${response.status} ${text}`);
  }

  return {
    workflow: env.GITHUB_WORKFLOW_FILE,
    ref: env.GITHUB_WORKFLOW_REF,
    reason: `Hermes changed: main=${latest.mainSha}, tag=${latest.latestTagName || "none"}`
  };
}

async function githubJson(path, token) {
  const response = await githubFetch(path, token);
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub API failed: ${response.status} ${text}`);
  return JSON.parse(text);
}

function githubFetch(path, token, init = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "tip-verify-hermes-cron",
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {})
    }
  });
}

function assertEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Missing required binding/env: ${missing.join(", ")}`);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "content-type": "application/json" }
  });
}
