#!/usr/bin/env node
import { parseArgs, run } from '../dist/cli.js';

try {
  const opts = parseArgs(process.argv.slice(2));
  const result = await run(opts);
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.stderr.write('\nUsage:\n  rastrum-import --dir <path> --baseUrl <https://…/functions/v1> --token rst_…\n');
  process.stderr.write('  Optional: --log <path> --dry-run --skip-identify --notes "<text>" --verbose\n');
  process.exit(2);
}
