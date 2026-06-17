#!/usr/bin/env node
import { cmdLogin, cmdWhoami, cmdSeed, cmdPush, cmdBake, cmdStatus, cmdBumpVersion } from "../src/commands.js";

// Minimal argv parser: collects --flags (with values or boolean) and positionals.
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const HELP = `
asset-portal — seed and manage a Molta portal

Usage:
  asset-portal login --url <portal-url> --token <apt_...>   Connect & save credentials
  asset-portal whoami                                       Show the target portal + access code
  asset-portal seed <manifest.json> [--dir <root>] [--dry-run] [--bump | --schema-version <N>]
                                                            Upsert assets, upload placeholders, optionally bump schema version
  asset-portal push --key <asset_key> --file <path> [--final]
                                                            Upload a single version
  asset-portal bake [--out <dir>] [--require-final]         Download published assets to bundle in
                                                            a production build (default ./AssetPortalBaked)
  asset-portal status                                       Report production-readiness (all assets done?)
  asset-portal bump-version [--to <N>]                       Bump the asset schema version (old apps must update)

Environment:
  ASSET_PORTAL_URL, ASSET_PORTAL_TOKEN   override saved config

Seed manifest format: see packages/cli/README.md
`;

async function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  try {
    switch (command) {
      case "login": case "init": await cmdLogin(args); break;
      case "whoami": await cmdWhoami(args); break;
      case "seed": await cmdSeed(args); break;
      case "push": await cmdPush(args); break;
      case "bake": await cmdBake(args); break;
      case "status": await cmdStatus(args); break;
      case "bump-version": await cmdBumpVersion(args); break;
      case undefined: case "help": case "--help": case "-h":
        console.log(HELP); break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\x1b[31m✗ ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

main();
