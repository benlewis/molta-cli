# asset-portal CLI

A dependency-free Node CLI (macOS/Linux/Windows, Node ≥ 18.17) to seed and manage
an [Asset Portal](../../README.md). Designed so an AI like **Claude Code** can
analyze a game's codebase, extract its assets, write requirements, and hand a
manifest to this tool in one shot.

## Install

```bash
# From the monorepo
npm install
npm link --workspace=packages/cli      # exposes `asset-portal` globally
# …or run directly
node packages/cli/bin/asset-portal.js --help
```

## Authenticate

1. In the portal, open your project → **CLI / API tokens** → generate one.
2. Save it (stored at `~/.asset-portal/config.json`, mode 600):

```bash
asset-portal login --url https://your-portal.vercel.app --token apt_xxxxxxxx…
asset-portal whoami        # prints the portal name + 6-digit access code
```

Or skip the file and use env vars: `ASSET_PORTAL_URL`, `ASSET_PORTAL_TOKEN`.

## Seed

```bash
asset-portal seed game-assets.manifest.json --dir ./extracted-assets
asset-portal seed game-assets.manifest.json --dry-run   # validate, send nothing
```

`seed` is **idempotent** — run it again after editing the manifest and it updates
in place (matched by `key`). For each asset with a `placeholder` file it uploads
the bytes as the asset's initial placeholder version.

## Manifest format

```jsonc
{
  "sections": [
    { "name": "Character Art", "description": "optional" }
  ],
  "groups": [                        // optional: assets that ship together
    { "name": "Explosion animation", "section": "Character Art",
      "description": "frames delivered as a unit" }
  ],
  "assets": [
    {
      "key": "hero_ship",            // REQUIRED, lower_snake_case, stable SDK id
      "name": "Hero ship sprite",    // REQUIRED, human label
      "type": "image",               // image|video|audio|music|sound|level|model|font|text|data|other
      "section": "Character Art",    // optional; created if missing
      "group": "Explosion animation",// optional group name; created if missing.
                                     //   The contractor must upload every asset in
                                     //   a group before they can Share it.
      "description": "What you want — style, mood, references…",
      "requirements": {              // optional, free-form but these keys render nicely:
        "width": 256, "height": 256, "format": "png", "max_kb": 120,
        "duration_sec": 60, "loop": true, "fps": 30,
        "sample_rate": 44100, "channels": 2
      },
      "placeholder": "placeholders/hero_ship.png"  // optional path (rel. to --dir)
    }
  ]
}
```

See [`examples/galaxy-raiders.manifest.json`](./examples/galaxy-raiders.manifest.json).

## Let an AI build the manifest

The whole point: point Claude Code at your game and let it produce the manifest.
A prompt that works well:

> Analyze this codebase and produce an `asset-portal` seed manifest
> (`game-assets.manifest.json`). Find every art, audio, music, video, level, and
> font asset the game loads — search for image/sound loading calls, asset
> catalogs, `Resources/` and `Assets/` folders, and file references in code.
> For each, emit an object with a stable lower_snake_case `key`, a `name`, the
> right `type`, a `section`, a `description` of what a contractor should produce,
> and `requirements` inferred from how the asset is used (dimensions from the
> sprite/atlas, duration/loop for audio, format from the file extension). If a
> current asset file exists, set `placeholder` to its path so it's uploaded as
> the starting point. Follow the schema in `packages/cli/README.md`. Then run:
> `asset-portal seed game-assets.manifest.json --dry-run` and fix any errors.

The repo's [`SEEDING.md`](../../SEEDING.md) contains a longer, copy-pasteable
version of this guidance.

## Commands

| Command | Purpose |
| --- | --- |
| `login` / `init` | Validate + save portal URL and API token |
| `whoami` | Show the target portal name, access code, asset count |
| `seed <manifest> [--dir] [--dry-run]` | Upsert sections/assets, upload placeholders |
| `push --key <k> --file <p> [--final]` | Upload a single asset version |
| `bake [--out <dir>] [--require-final]` | Download published assets to bundle in a production build |

## Bake for production

The runtime SDK downloads assets over the air in DEV/TEST builds. For a
production build you **bake** the finalized assets into the app:

```bash
asset-portal bake --out AssetPortalBaked --require-final
```

This downloads every published asset and writes `asset-portal-manifest.json`
alongside the files into `AssetPortalBaked/`. With `--require-final` it aborts
unless every asset is **Done** (so you never ship a placeholder or in-review
version). Add the folder to your app target — see
[`swift/AssetPortalKit/README.md`](../../swift/AssetPortalKit/README.md). In
release builds the SDK loads these bundled files and never contacts the portal.
