const fs = require("fs");
const https = require("https");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");
const OUTPUT_README = path.join(__dirname, "README.md");

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "osmosis-utils-builder" } },
      (res) => {
        if (res.statusCode === 403 || res.statusCode === 429) {
          console.warn(
            `  GitHub API rate limited (${res.statusCode}). Cannot generate README.`
          );
          resolve(null);
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Failed to parse JSON from ${url}`));
          }
        });
      }
    );
    req.on("error", reject);
  });
}

async function fetchAllRepos(user) {
  const repos = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/users/${user}/repos?per_page=100&page=${page}&sort=pushed&direction=desc`;
    console.log(`  Fetching page ${page}...`);
    const batch = await fetchJSON(url);
    if (batch === null) return null;
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

function titleFromName(name) {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bIbc\b/g, "IBC")
    .replace(/\bCctp\b/g, "CCTP")
    .replace(/\bRpc\b/g, "RPC")
    .replace(/\bApi\b/g, "API")
    .replace(/\bSdk\b/g, "SDK")
    .replace(/\bGrpc\b/g, "gRPC")
    .replace(/\bCsv\b/g, "CSV")
    .replace(/\bCl\b/g, "CL")
    .replace(/\bOsmojs\b/g, "OsmoJS")
    .replace(/\bNodejs\b/g, "Node.js")
    .replace(/\bTfm\b/g, "TFM")
    .replace(/\bDapp\b/g, "dApp");
}

function deployLabel(url) {
  if (url.includes("github.io")) return "GitHub Pages";
  if (url.includes("vercel.app")) return "Vercel";
  return "Website";
}

function buildREADME(config, pinned, rest) {
  const user = config.githubUser;
  const all = [...pinned, ...rest];

  const lines = [
    `# ${config.title}`,
    "",
    config.subtitle,
    "",
    `[Live site on GitHub Pages](https://${user}.github.io/osmosis-utils/)`,
    "",
  ];

  if (pinned.length) {
    lines.push("## Pinned", "");
    lines.push("| Name | Description | Language | Links |");
    lines.push("|------|-------------|----------|-------|");
    for (const r of pinned) {
      const title =
        (config.titleOverrides && config.titleOverrides[r.name]) ||
        titleFromName(r.name);
      const desc = (r.description || "").replace(/\|/g, "\\|");
      const lang = r.language || "";
      const repoLink = `[Repo](${r.html_url})`;
      const launchUrl =
        (config.launchOverrides && config.launchOverrides[r.name]) ||
        (r.has_pages ? `https://${user}.github.io/${r.name}/` : null);
      const deployLink = launchUrl ? ` / [${deployLabel(launchUrl)}](${launchUrl})` : "";
      lines.push(
        `| **${title}** | ${desc} | ${lang} | ${repoLink}${deployLink} |`
      );
    }
    lines.push("");
  }

  if (rest.length) {
    lines.push("## All Repositories", "");
    lines.push("| Name | Description | Language | Updated | Links |");
    lines.push("|------|-------------|----------|---------|-------|");
    for (const r of rest) {
      const title =
        (config.titleOverrides && config.titleOverrides[r.name]) ||
        titleFromName(r.name);
      const desc = (r.description || "").replace(/\|/g, "\\|");
      const lang = r.language || "";
      const updated = r.pushed_at ? r.pushed_at.slice(0, 10) : "";
      const repoLink = `[Repo](${r.html_url})`;
      const launchUrl =
        (config.launchOverrides && config.launchOverrides[r.name]) ||
        (r.has_pages ? `https://${user}.github.io/${r.name}/` : null);
      const deployLink = launchUrl ? ` / [${deployLabel(launchUrl)}](${launchUrl})` : "";
      lines.push(
        `| **${title}** | ${desc} | ${lang} | ${updated} | ${repoLink}${deployLink} |`
      );
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    `Built by [@${user}](https://github.com/${user}). Run \`node build.js\` to regenerate this README from [config.json](config.json).`,
    "",
    "The [live site](https://" +
      user +
      ".github.io/osmosis-utils/) loads dynamically from the GitHub API — no build step needed for the page itself."
  );

  return lines.join("\n") + "\n";
}

async function main() {
  console.log("Reading config.json...");
  const config = readConfig();

  const excludeSet = new Set(config.exclude || []);
  const pinnedNames = config.pinned || [];
  const pinnedSet = new Set(pinnedNames);
  const includeSet = new Set(config.include || []);
  const patterns = (config.repoPatterns || []).map((p) => new RegExp(p));

  console.log("Fetching repos from GitHub...");
  const ghRepos = await fetchAllRepos(config.githubUser);
  if (!ghRepos) {
    console.error("Cannot generate README without GitHub data.");
    process.exit(1);
  }

  const matches = ghRepos.filter((r) => {
    if (r.private) return false;
    if (excludeSet.has(r.name)) return false;
    if (pinnedSet.has(r.name)) return true;
    if (includeSet.has(r.name)) return true;
    if (r.fork) return false;
    return patterns.some((p) => p.test(r.name));
  });

  const repoMap = new Map(matches.map((r) => [r.name, r]));

  const pinned = pinnedNames
    .filter((name) => repoMap.has(name))
    .map((name) => repoMap.get(name));

  const rest = matches
    .filter((r) => !pinnedSet.has(r.name))
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

  console.log(
    `Found ${pinned.length} pinned + ${rest.length} other = ${pinned.length + rest.length} total repos.`
  );

  const unknownPatternMatches = ghRepos.filter((r) => {
    if (r.private || r.fork) return false;
    if (excludeSet.has(r.name)) return false;
    if (repoMap.has(r.name)) return false;
    return patterns.some((p) => p.test(r.name));
  });

  for (const r of unknownPatternMatches) {
    console.warn(
      `  New matching repo: ${r.name} — add to include/pinned or exclude in config.json`
    );
  }

  console.log("Generating README.md...");
  fs.writeFileSync(OUTPUT_README, buildREADME(config, pinned, rest), "utf-8");

  console.log("Done!");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
