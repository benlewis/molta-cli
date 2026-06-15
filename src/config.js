import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".asset-portal");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Resolve config from (in priority order): env vars, then the saved config file.
 *   ASSET_PORTAL_URL    base URL of the portal (e.g. https://my.vercel.app)
 *   ASSET_PORTAL_TOKEN  API token (apt_...)
 */
export function loadConfig() {
  let file = {};
  if (existsSync(CONFIG_PATH)) {
    try { file = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { /* ignore */ }
  }
  return {
    url: process.env.ASSET_PORTAL_URL || file.url || "",
    token: process.env.ASSET_PORTAL_TOKEN || file.token || "",
  };
}

export function saveConfig({ url, token }) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ url, token }, null, 2));
  // Token is a secret — lock the file down.
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* best effort */ }
  return CONFIG_PATH;
}

export function requireConfig() {
  const cfg = loadConfig();
  if (!cfg.url || !cfg.token) {
    throw new Error(
      "Not configured. Run `asset-portal login --url <portal-url> --token <apt_...>`\n" +
      "or set ASSET_PORTAL_URL and ASSET_PORTAL_TOKEN."
    );
  }
  return cfg;
}

export { CONFIG_PATH };
