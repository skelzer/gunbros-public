/**
 * The shared package is the deterministic core: DESIGN §1.2 and §2.1 say zero DOM, zero
 * Node, zero Math.random and no engine transcendentals. ESLint enforces it while linting;
 * this test enforces it in CI even if someone disables a rule inline.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const packageDir = join(here, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strip comments and string literals so documentation can name the banned APIs. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const files = walk(srcDir);

describe('shared purity', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('never calls a non-deterministic Math member', () => {
    const banned =
      /Math\.(random|sin|cos|tan|asin|acos|atan|atan2|exp|expm1|pow|log|log2|log10|log1p|hypot|cbrt|sinh|cosh|tanh|fround)\b/;
    const offenders: string[] = [];
    for (const file of files) {
      const body = code(readFileSync(file, 'utf8'));
      const match = banned.exec(body);
      if (match) offenders.push(`${relative(packageDir, file)}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('never imports Node or touches the DOM', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      const body = code(raw);
      if (/from\s+'node:/.test(raw) || /require\s*\(/.test(body)) {
        offenders.push(`${relative(packageDir, file)}: node import`);
      }
      if (/\b(window|document|localStorage|navigator|HTMLCanvasElement|ImageData)\b/.test(body)) {
        offenders.push(`${relative(packageDir, file)}: DOM reference`);
      }
      if (/\bprocess\.|\bBuffer\b|__dirname/.test(body)) {
        offenders.push(`${relative(packageDir, file)}: Node global`);
      }
      if (/\bDate\.now\b|new Date\(/.test(body)) {
        offenders.push(`${relative(packageDir, file)}: wall clock`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
