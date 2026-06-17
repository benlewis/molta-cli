import { resolve, dirname, isAbsolute, join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { PortalClient, guessMime } from "./client.js";
import { loadConfig, saveConfig, requireConfig, CONFIG_PATH } from "./config.js";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const EXT_BY_MIME = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg",
  "video/mp4": "mp4", "application/json": "json", "font/ttf": "ttf", "font/otf": "otf",
};
function extFor(entry) {
  try {
    const m = new URL(entry.url).pathname.match(/\.([a-z0-9]+)$/i);
    if (m) return m[1].toLowerCase();
  } catch { /* ignore */ }
  return EXT_BY_MIME[entry.mime_type] || "bin";
}

export async function cmdLogin(args) {
  const existing = loadConfig();
  const url = args.url || existing.url;
  const token = args.token || existing.token;
  if (!url || !token) {
    throw new Error("Usage: molta login --url <portal-url> --token <apt_...>");
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
  console.log(`  Access code:    ${c.cyan(p.access_code)}`);
  console.log(`  Assets:         ${p.asset_count}`);
  console.log(`  Schema version: ${c.cyan(p.schema_version ?? 1)}`);
}

export async function cmdBumpVersion(args) {
  // Increment (or set) the project's asset-schema version. Apps built for an
  // older version will be told to update before they can sync.
  const client = new PortalClient(requireConfig());
  const to = args.to != null ? Number(args.to) : undefined;
  const { schema_version } = await client.setSchemaVersion(
    to != null ? { version: to } : { bump: true }
  );
  console.log(c.green(`✓ Asset schema version is now ${schema_version}`));
  console.log(c.dim("  Build your app with supportedSchemaVersion >= this. Older apps will be"));
  console.log(c.dim("  told to update before they can download assets."));
}

export async function cmdSeed(args) {
  const manifestPath = args._[0];
  if (!manifestPath) throw new Error("Usage: molta seed <manifest.json> [--dir <assets-root>] [--dry-run]");
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

  // Schema version: from the manifest, or --schema-version N, or --bump.
  const schemaVersion = typeof manifest.schema_version === "number" ? manifest.schema_version
    : (args["schema-version"] != null ? Number(args["schema-version"]) : undefined);

  // 1. Upsert metadata. Strip the local-only `placeholder` path; the server
  //    just needs key/name/type/description/requirements/section/group.
  const seedAssets = assets.map(({ placeholder, ...rest }) => rest);
  const result = await client.seed(sections, groups, seedAssets, { schemaVersion, bump: !!args.bump });
  const created = result.results.filter((r) => r.created).length;
  console.log(c.green(`✓ Upserted ${result.results.length} asset(s)`) + c.dim(` (${created} new)`));
  if (args.bump || schemaVersion != null) {
    console.log(c.cyan(`  Asset schema version → ${result.schema_version}`) + c.dim(" (apps below this must update)"));
  }

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
  if (!key || !file) throw new Error("Usage: molta push --key <asset_key> --file <path> [--final]");
  const client = new PortalClient(requireConfig());
  const v = await client.upload(key, resolve(process.cwd(), file), { isPlaceholder: !args.final });
  console.log(c.green(`✓ Uploaded ${key} as v${v.version_number}`));
}

export async function cmdBake(args) {
  // Download every published asset and write a baked manifest + a zero-dependency
  // Swift accessor, to bundle assets directly into a production build.
  const out = resolve(process.cwd(), args.out || "MoltaBaked");
  const folderName = out.split("/").pop();
  const client = new PortalClient(requireConfig());
  const [{ asset_count: total }, { project, assets }] = await Promise.all([client.project(), client.bake()]);
  if (!assets.length) throw new Error("No published assets to bake yet (publish some via 'See in app' / 'Done').");

  mkdirSync(out, { recursive: true });
  console.log(`${c.bold("Baking")} ${assets.length} asset(s) from ${c.bold(project)} → ${out}`);

  const baked = [];
  const notFinal = [];
  for (const a of assets) {
    const file = `${a.key}.${extFor(a)}`;
    process.stdout.write(`  ↓ ${a.key} … `);
    const res = await fetch(a.url);
    if (!res.ok) { console.log(c.red(`failed (${res.status})`)); continue; }
    writeFileSync(join(out, file), Buffer.from(await res.arrayBuffer()));
    baked.push({ key: a.key, name: a.name, type: a.type, version: a.version, checksum: a.checksum, file, metadata: a.metadata || {} });
    if (!a.is_final) notFinal.push(a);
    const tag = a.is_final ? c.green("done") : a.is_placeholder ? c.red("placeholder!") : c.yellow("preview");
    console.log(`${file} ${c.dim("(")}${tag}${c.dim(")")}`);
  }

  writeFileSync(join(out, "molta-manifest.json"),
    JSON.stringify({ project, baked_at: new Date().toISOString(), assets: baked }, null, 2));
  writeFileSync(join(out, "MoltaBaked.swift"), genSwiftAccessor(baked, folderName));

  console.log("");
  console.log(c.green(`✓ Baked ${baked.length} file(s)`) + ` + molta-manifest.json + MoltaBaked.swift`);
  console.log(c.dim(`  Add the "${folderName}" folder to your app target. In production, use MoltaBaked`));
  console.log(c.dim(`  (no MoltaKit dependency) — see swift/MoltaKit/README.md.`));

  reportReadiness(total, baked.length, notFinal);
  if (notFinal.length && args["require-final"]) {
    throw new Error("Aborting: --require-final set and not all assets are finalized.");
  }
}

export async function cmdStatus() {
  // Report production-readiness without downloading anything.
  const client = new PortalClient(requireConfig());
  const [{ asset_count: total, name, schema_version }, { assets }] = await Promise.all([client.project(), client.bake()]);
  const done = assets.filter((a) => a.is_final).length;
  const placeholder = assets.filter((a) => a.is_placeholder).length;
  const preview = assets.length - done - placeholder;
  const unpublished = Math.max(0, total - assets.length);

  console.log(`${c.bold(name)} — ${total} asset(s) · schema v${schema_version ?? 1}`);
  console.log(`  ${c.green(`${done} done`)} · ${c.yellow(`${preview} preview`)} · ${c.red(`${placeholder} placeholder`)} · ${c.dim(`${unpublished} not uploaded`)}`);
  reportReadiness(total, assets.length, assets.filter((a) => !a.is_final));
}

function reportReadiness(total, publishedCount, notFinal) {
  console.log("");
  const ready = notFinal.length === 0 && publishedCount === total && total > 0;
  if (ready) {
    console.log(c.green(`✅ READY FOR PRODUCTION — all ${total} assets are finalized.`));
  } else {
    console.log(c.yellow(`⛔ NOT READY FOR PRODUCTION`));
    const missing = total - (publishedCount - notFinal.length);
    console.log(c.yellow(`   ${missing} of ${total} asset(s) are not finalized ("done"):`));
    for (const a of notFinal) console.log(c.yellow(`     • ${a.key} (${a.status})`));
    if (total > publishedCount) console.log(c.yellow(`     • ${total - publishedCount} asset(s) with no upload yet`));
    console.log(c.dim("   Mark every asset Done in the portal before shipping."));
  }
}

function genSwiftAccessor(baked, folderName) {
  const keys = baked.map((a) => `"${a.key}"`).join(", ");
  const files = baked.map((a) => `        "${a.key}": "${a.file}",`).join("\n");
  return `// Generated by \`molta bake\`. Do not edit.
//
// Zero-dependency accessor for assets baked into the app bundle. Use this in
// production INSTEAD of MoltaKit, so the over-the-air downloader is not
// compiled into release builds, e.g.:
//
//   #if DEBUG
//   let url = portal.localURL(forKey: "hero_ship")   // MoltaKit
//   #else
//   let url = MoltaBaked.url(forKey: "hero_ship")
//   #endif
import Foundation

public enum MoltaBaked {
    public static let keys: [String] = [${keys}]

    private static let files: [String: String] = [
${files}
    ]

    public static func url(forKey key: String, bundle: Bundle = .main) -> URL? {
        guard let file = files[key] else { return nil }
        let name = (file as NSString).deletingPathExtension
        let ext = (file as NSString).pathExtension
        return bundle.url(forResource: name, withExtension: ext, subdirectory: "${folderName}")
            ?? bundle.url(forResource: name, withExtension: ext)
    }

    public static func data(forKey key: String, bundle: Bundle = .main) -> Data? {
        url(forKey: key, bundle: bundle).flatMap { try? Data(contentsOf: $0) }
    }
}
`;
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
