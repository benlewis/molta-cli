# molta CLI

A dependency-free Node CLI (macOS/Linux/Windows, Node ≥ 18.17) to seed and manage
an [Molta](../../README.md). Designed so an AI like **Claude Code** can
analyze a game's codebase, extract its assets, write requirements, and hand a
manifest to this tool in one shot.

## Install

End users (zero dependencies, Node ≥ 18.17):

```bash
npm install -g github:benlewis/molta-cli   # → `molta` command
# npm install -g molta-cli                 # from npm, once published
# npx github:benlewis/molta-cli --help     # run without installing
```

From the monorepo (for development):

```bash
npm install
npm link --workspace=packages/cli          # exposes `molta` globally
# …or: node packages/cli/bin/molta.js --help
```

## Authenticate

1. In the portal, open your project → **CLI / API tokens** → generate one.
2. Save it (stored at `~/.molta/config.json`, mode 600):

```bash
molta login --url https://molta.dev --token apt_xxxxxxxx…
molta whoami        # prints the portal name + 6-digit access code
```

Or skip the file and use env vars: `MOLTA_URL`, `MOLTA_TOKEN`.

## Seed

```bash
molta seed game-assets.manifest.json --dir ./extracted-assets
molta seed game-assets.manifest.json --dry-run   # validate, send nothing
molta seed game-assets.manifest.json --prune      # make the manifest the source of truth
molta seed game-assets.manifest.json --prune --dry-run   # preview what add/update/delete
molta seed game-assets.manifest.json --prune --yes       # skip the delete confirmation (CI)
```

**`--prune`** deletes any assets in the portal that aren't in the manifest, so the
manifest becomes the single source of truth. It first prints the diff
(new / update / delete) and **asks for confirmation** before deleting (cascades
the asset's versions/comments); pass `--yes` to skip the prompt, or `--dry-run`
to preview without changing anything.

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

> Analyze this codebase and produce an `molta` seed manifest
> (`game-assets.manifest.json`). Find every art, audio, music, video, level, and
> font asset the game loads — search for image/sound loading calls, asset
> catalogs, `Resources/` and `Assets/` folders, and file references in code.
> For each, emit an object with a stable lower_snake_case `key`, a `name`, the
> right `type`, a `section`, a `description` of what a contractor should produce,
> and `requirements` inferred from how the asset is used (dimensions from the
> sprite/atlas, duration/loop for audio, format from the file extension). If a
> current asset file exists, set `placeholder` to its path so it's uploaded as
> the starting point. Follow the schema in `packages/cli/README.md`. Then run:
> `molta seed game-assets.manifest.json --dry-run` and fix any errors.

The repo's [`SEEDING.md`](../../SEEDING.md) contains a longer, copy-pasteable
version of this guidance.

## Commands

| Command | Purpose |
| --- | --- |
| `login` / `init` | Validate + save portal URL and API token |
| `whoami` | Show the target portal name, access code, asset count |
| `seed <manifest> [--dir] [--dry-run] [--prune] [--yes]` | Upsert sections/assets, upload placeholders; `--prune` deletes assets not in the manifest |
| `push --key <k> --file <p> [--final]` | Upload a single asset version |
| `bake [--out <dir>] [--require-final]` | Download published assets to bundle in a production build |
| `status` | Report production-readiness (are all assets finalized?) |
| `bump-version [--to <N>]` | Bump the asset schema version (old app builds must update) |

## Asset schema versioning

Each portal has a **schema version** — the minimum app build required to handle
its current assets. When you add asset types that need a new app build, bump it:

```bash
molta bump-version                 # +1
molta seed new-assets.json --bump  # seed and bump together
molta bump-version --to 5          # set explicitly
```

Build the app with `supportedSchemaVersion` ≥ this (see the SDK README). Older
apps get an "app out of date — please update" error from the SDK instead of
downloading assets they can't use. `whoami` / `status` show the current version.

## Bake for production

The runtime SDK downloads assets over the air in DEV/TEST builds. For a
production build you **bake** the finalized assets into the app:

```bash
molta status                                   # READY / NOT READY report
molta bake --out MoltaBaked --require-final
```

`bake` downloads every published asset and writes into `MoltaBaked/`:
- the asset files,
- `molta-manifest.json`,
- **`MoltaBaked.swift`** — a generated, zero-dependency accessor so a
  production build can load baked assets *without* linking MoltaKit at all.

With `--require-final` it aborts unless every asset is **Done** (so you never ship
a placeholder or in-review version). Both `bake` and `status` print a clear
**✅ READY / ⛔ NOT READY FOR PRODUCTION** summary. See
[`swift/MoltaKit/README.md`](../../swift/MoltaKit/README.md) for how to
exclude the downloader from release builds.
