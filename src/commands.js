import { resolve, dirname, isAbsolute } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { PortalClient } from "./client.js";
import { loadConfig, saveConfig, requireConfig, CONFIG_PATH } from "./config.js";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

export async function cmdLogin(args) {
  const existing = loadConfig();
  const url = args.url || existing.url;
  const token = args.token || existing.token;
  if (!url || !token) {
    throw new Error("Usage: asset-portal login --url <portal-url> --token <apt_...>");
  }
  // Validate by hitting the portal.
  const client = new PortalClient({ url, token });
  const project = await client.project();
  const path = saveConfig({ url, token });
  console.log(c.green("✓ Connected to ") + c.bold(project.name));
  console.log(`  Access code: ${c.cyan(project.access_code)}  (enter this in your app)`);
  console.log(c.dim(`  Saved to ${path}`));
}

export async function cmdWhoami() {
  const client = new PortalClient(requireConfig());
  const p = await client.project();
  console.log(`${c.bold(p.name)}`);
  console.log(`  Access code: ${c.cyan(p.access_code)}`);
  console.log(`  Assets:      ${p.asset_count}`);
}

export async function cmdSeed(args) {
  const manifestPath = args._[0];
  if (!manifestPath) throw new Error("Usage: asset-portal seed <manifest.json> [--dir <assets-root>] [--dry-run]");
  const absManifest = resolve(process.cwd(), manifestPath);
  if (!existsSync(absManifest)) throw new Error(`Manifest not found: ${absManifest}`);

  const manifest = JSON.parse(readFileSync(absManifest, "utf8"));
  const baseDir = args.dir ? resolve(process.cwd(), args.dir) : dirname(absManifest);
  const { sections, groups, assets } = validateManifest(manifest);

  // Resolve + verify any placeholder file paths before touching the network.
  const uploads = [];
  for (const a of assets) {
    if (a.placeholder) {
      const p = isAbsolute(a.placeholder) ? a.placeholder : resolve(baseDir, a.placeholder);
      if (!existsSync(p)) throw new Error(`Placeholder for "${a.key}" not found: ${p}`);
      uploads.push({ key: a.key, path: p });
    }
  }

  console.log(`${c.bold("Seeding")} ${assets.length} asset(s), ${sections.length} section(s), ${groups.length} group(s), ${uploads.length} placeholder file(s)`);
  if (args["dry-run"]) {
    console.log(c.dim("(dry run — nothing sent)"));
    for (const a of assets) console.log(`  • ${a.key} ${c.dim(`(${a.type})`)}${a.group ? c.dim(` [${a.group}]`) : ""}${a.placeholder ? c.dim(` ← ${a.placeholder}`) : ""}`);
    return;
  }

  const client = new PortalClient(requireConfig());

  // 1. Upsert metadata. Strip the local-only `placeholder` path; the server
  //    just needs key/name/type/description/requirements/section/group.
  const seedAssets = assets.map(({ placeholder, ...rest }) => rest);
  const result = await client.seed(sections, groups, seedAssets);
  const created = result.results.filter((r) => r.created).length;
  console.log(c.green(`✓ Upserted ${result.results.length} asset(s)`) + c.dim(` (${created} new)`));

  // 2. Upload placeholder files.
  for (const u of uploads) {
    process.stdout.write(`  ↑ ${u.key} … `);
    try {
      const v = await client.upload(u.key, u.path);
      console.log(c.green(`v${v.version_number}`));
    } catch (e) {
      console.log(c.red(`failed: ${e.message}`));
    }
  }

  const project = await client.project();
  console.log("");
  console.log(`${c.bold("Done.")} Portal access code: ${c.cyan(project.access_code)}`);
}

export async function cmdPush(args) {
  const key = args.key;
  const file = args.file || args._[0];
  if (!key || !file) throw new Error("Usage: asset-portal push --key <asset_key> --file <path> [--final]");
  const client = new PortalClient(requireConfig());
  const v = await client.upload(key, resolve(process.cwd(), file), { isPlaceholder: !args.final });
  console.log(c.green(`✓ Uploaded ${key} as v${v.version_number}`));
}

// ── Manifest validation ────────────────────────────────────────────────────
const VALID_TYPES = ["image", "video", "audio", "music", "sound", "level", "model", "font", "text", "data", "other"];

export function validateManifest(m) {
  if (!m || typeof m !== "object") throw new Error("Manifest must be a JSON object");
  const sections = Array.isArray(m.sections) ? m.sections : [];
  const groups = Array.isArray(m.groups) ? m.groups : [];
  const assets = Array.isArray(m.assets) ? m.assets : [];
  if (assets.length === 0) throw new Error("Manifest has no assets[]");

  for (const [i, g] of groups.entries()) {
    if (!g.name) throw new Error(`groups[${i}]: name is required`);
  }

  const keys = new Set();
  for (const [i, a] of assets.entries()) {
    if (!a.key || !/^[a-z0-9_]+$/.test(a.key)) {
      throw new Error(`assets[${i}]: key must be lower_snake_case (got ${JSON.stringify(a.key)})`);
    }
    if (keys.has(a.key)) throw new Error(`Duplicate asset key: ${a.key}`);
    keys.add(a.key);
    if (!a.name) throw new Error(`assets[${i}] (${a.key}): name is required`);
    if (a.type && !VALID_TYPES.includes(a.type)) {
      throw new Error(`assets[${i}] (${a.key}): invalid type "${a.type}". One of: ${VALID_TYPES.join(", ")}`);
    }
    if (a.requirements && typeof a.requirements !== "object") {
      throw new Error(`assets[${i}] (${a.key}): requirements must be an object`);
    }
    if (a.group && typeof a.group !== "string") {
      throw new Error(`assets[${i}] (${a.key}): group must be a group name (string)`);
    }
  }
  return { sections, groups, assets };
}

export { CONFIG_PATH };
