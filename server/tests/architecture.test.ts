/**
 * A poor man's dependency rule (audit 4.1, rec 3).
 *
 * The repo has no lint tooling, so the single-writer invariant for the
 * `tableSlots` collection is enforced by reading the source tree: only
 * `src/lib/slots.ts` may import the `TableSlot` model. This runs in CI, so a
 * future `services/staff.ts` that reaches for `TableSlot.deleteMany` directly
 * fails the build instead of shipping a silently broken invariant.
 *
 * It is deliberately dumb: a regex over file text. It does not need to resolve
 * modules to answer "does this file mention the model".
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(SERVER_ROOT, 'src');

/** The one module allowed to touch the collection. */
const SOLE_OWNER = path.join('src', 'lib', 'slots.ts');

/** The model definition itself, which obviously has to name the model. */
const MODEL_DEFINITION = path.join('src', 'models', 'TableSlot.ts');

/**
 * Matches an import of the `TableSlot` model:
 *   import { TableSlot } from '../models/TableSlot.js'
 *   import type { TableSlotDocument } from ...
 * Also matches `export ... from` re-exports, which are the same dependency.
 */
const TABLE_SLOT_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;\n]*from\s+['"][^'"]*models\/TableSlot(?:\.js)?['"]/;

/**
 * Removes line and block comments.
 *
 * Necessary because prose about the model is not a dependency on it: `db.ts`
 * names `models/TableSlot.ts` in a comment explaining where the index is
 * declared, and that must not count as a violation. Crude but adequate - it
 * does not try to understand strings, which is fine for a guard whose failure
 * mode is a false positive a human reads in ten seconds.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every `.ts` file under a directory, recursively. */
async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/** Source files under `server/src` that import the `TableSlot` model. */
async function filesImportingTableSlot(): Promise<string[]> {
  const files = await listTypeScriptFiles(SRC_ROOT);
  const offenders: string[] = [];

  for (const file of files) {
    const source = stripComments(await readFile(file, 'utf8'));
    if (TABLE_SLOT_IMPORT.test(source)) {
      offenders.push(path.relative(SERVER_ROOT, file));
    }
  }

  return offenders.sort();
}

describe('architecture: slot mutation is confined to one module', () => {
  it('finds source files to scan (guards against a silently empty check)', async () => {
    const files = await listTypeScriptFiles(SRC_ROOT);
    // If this ever trips, the scanner is broken, not the architecture.
    expect(files.length).toBeGreaterThan(10);
  });

  it('only src/lib/slots.ts imports the TableSlot model', async () => {
    const importers = await filesImportingTableSlot();
    expect(importers).toEqual([SOLE_OWNER]);
  });

  it('the scanner would catch a violation (negative control)', async () => {
    // Proves the regex is not vacuously true: a realistic violating import
    // must match, or the test above proves nothing.
    const violation = [
      "import { Router } from 'express';",
      "import { TableSlot } from '../models/TableSlot.js';",
      '',
      'export const router = Router();',
    ].join('\n');

    expect(TABLE_SLOT_IMPORT.test(violation)).toBe(true);
  });

  it('no source file outside the slots module names the model at all', async () => {
    // Stronger than the import check: `TableSlot.collection` would be an
    // escape hatch even without an import, so catch the identifier anywhere
    // outside the owner. The model definition file is exempt because it is
    // where the identifier is introduced.
    const files = await listTypeScriptFiles(SRC_ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const relative = path.relative(SERVER_ROOT, file);
      if (relative === SOLE_OWNER || relative === MODEL_DEFINITION) {
        continue;
      }
      const source = stripComments(await readFile(file, 'utf8'));
      if (/\bTableSlot\b/.test(source)) {
        offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });
});
