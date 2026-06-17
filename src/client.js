import { basename } from "node:path";
import { readFileSync } from "node:fs";

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml", wav: "audio/wav", mp3: "audio/mpeg",
  ogg: "audio/ogg", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime",
  json: "application/json", txt: "text/plain", csv: "text/csv",
  ttf: "font/ttf", otf: "font/otf",
};

export function guessMime(path) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Thin client around the portal's CLI/M2M API. */
export class PortalClient {
  constructor({ url, token }) {
    this.base = url.replace(/\/+$/, "");
    this.token = token;
  }

  async #json(path, { method = "GET", body } = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.error || `${method} ${path} → ${res.status}`);
    return data;
  }

  /** Verify the token and return { id, name, access_code, asset_count }. */
  project() { return this.#json("/api/v1/cli/project"); }

  /** All assets' published version + status + signed download URL, for baking. */
  bake() { return this.#json("/api/v1/cli/bake"); }

  /** Idempotently upsert sections + groups + assets (+ optional version bump/set). */
  seed(sections, groups, assets, opts = {}) {
    return this.#json("/api/v1/cli/seed", {
      method: "POST",
      body: { sections, groups, assets, schema_version: opts.schemaVersion, bump: opts.bump },
    });
  }

  /** Bump or set the project's asset-schema version. */
  setSchemaVersion({ bump, version } = {}) {
    return this.#json("/api/v1/cli/schema-version", { method: "POST", body: { bump, version } });
  }

  /** Upload a placeholder file for an existing asset_key (multipart). */
  async upload(assetKey, filePath, { isPlaceholder = true } = {}) {
    const buf = readFileSync(filePath);
    const form = new FormData();
    form.append("asset_key", assetKey);
    form.append("is_placeholder", String(isPlaceholder));
    form.append("file", new Blob([buf], { type: guessMime(filePath) }), basename(filePath));

    const res = await fetch(this.base + "/api/v1/cli/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.error || `upload ${assetKey} → ${res.status}`);
    return data;
  }
}
