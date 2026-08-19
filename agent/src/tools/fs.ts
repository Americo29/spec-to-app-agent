import { copyFile, mkdir, readdir, readFile, stat, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

/** Files larger than this are skipped by readFiles — they blow the context budget. */
const MAX_FILE_BYTES = 20 * 1024;

/**
 * What the snapshot never copies into the generated app.
 *
 * Principle (CLAUDE.md, snapshot contract): copy only what the generated app needs to
 * install, run, test and build. Agent-side and repo-side artifacts are not copied.
 * A new exclusion is justified against that principle, not by appending to a list.
 *
 * Exported so Stage 2 consumes this constant rather than redeclaring the list.
 */
export const SNAPSHOT_EXCLUDES = {
  /** Matched against a path segment's exact name, at any depth. */
  names: new Set([
    'node_modules',
    'dist',
    '.git',
    'agent',
    'generated-app',
    'specs',
    '.env',
    '.env.example',
    // OS and editor artifacts: they fail the "needed to install, run, test or build" test
    // by definition.
    '.DS_Store',
    'Thumbs.db',
    '.vscode',
    '.idea',
  ]),
  /** Matched against the end of a file name. */
  suffixes: ['.md', '.tsbuildinfo'],
} as const;

/** True when a path relative to the copy root must not reach the generated app. */
export function isExcluded(relPath: string): boolean {
  const segments = relPath.split(sep).filter(Boolean);
  if (segments.some((segment) => SNAPSHOT_EXCLUDES.names.has(segment))) return true;
  return SNAPSHOT_EXCLUDES.suffixes.some((suffix) => relPath.endsWith(suffix));
}

async function walk(root: string, current: string, out: string[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    const relativePath = relative(root, absolute);
    if (isExcluded(relativePath)) continue;
    if (entry.isDirectory()) {
      await walk(root, absolute, out);
    } else if (entry.isFile()) {
      out.push(relativePath);
    }
  }
}

/** Every non-excluded file under `root`, relative and sorted, one per line. */
export async function readTree(root: string): Promise<string> {
  const files: string[] = [];
  await walk(root, root, files);
  files.sort();
  console.log(`[tool:readTree] ${root} (${files.length} files)`);
  return files.join('\n');
}

/**
 * Read the given paths (relative to `root`) into a path → content map.
 * Missing files and files over 20KB are skipped rather than throwing: the caller asks for a
 * best-effort selection, not a guarantee.
 */
export async function readFiles(root: string, paths: string[]): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let skipped = 0;
  for (const path of paths) {
    const absolute = join(root, path);
    try {
      const info = await stat(absolute);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      files[path] = await readFile(absolute, 'utf8');
    } catch {
      skipped += 1;
    }
  }
  console.log(`[tool:readFiles] ${Object.keys(files).length} files read, ${skipped} skipped`);
  return files;
}

/** Write `content` to `path`, creating parent directories as needed. */
export async function writeFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await fsWriteFile(path, content, 'utf8');
  console.log(`[tool:writeFile] ${path}`);
}

async function copyTree(root: string, from: string, to: string): Promise<number> {
  let copied = 0;
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(from, entry.name);
    const relativePath = relative(root, source);
    if (isExcluded(relativePath)) continue;
    const destination = join(to, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true });
      copied += await copyTree(root, source, destination);
    } else if (entry.isFile()) {
      await copyFile(source, destination);
      copied += 1;
    }
  }
  return copied;
}

/** Recursively copy `src` into `dest`, honouring SNAPSHOT_EXCLUDES. Returns files copied. */
export async function copyDir(src: string, dest: string): Promise<number> {
  await mkdir(dest, { recursive: true });
  const copied = await copyTree(src, src, dest);
  console.log(`[tool:copyDir] ${src} → ${dest} (${copied} files)`);
  return copied;
}
