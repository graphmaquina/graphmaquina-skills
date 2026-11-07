import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { CheckError } from './model.ts';

/** The check that owns every problem found while reading the library docs. */
const CHECK: string = 'K-06';
const DOCS_DIR: string = 'docs/';
const VERSION_PATTERN: RegExp = /^\d+\.\d+\.\d+$/;
const MAX_OUTPUT_BYTES: number = 256 * 1024 * 1024;
/** The exit status of `git show-ref --exists` for a ref that is not there. */
const REF_ABSENT: number = 2;
/** How many of the files a refused docs branch changes outside `docs/` the message names. */
const LISTED_FILES: number = 10;

/** Where the docs were read from: the working tree, the release tag, or the version's docs branch. */
export type DocsRef =
  | { kind: 'worktree' }
  | { kind: 'tag'; tag: string }
  | { kind: 'branch'; name: string; tagCommit: string };

/**
 * The library's `docs/` at one version. `files` maps each path relative to `docs/` (for example `README.md` or
 * `images/README.md`) to its text; `gitRef` is the ref that goes into GitHub URLs: `v<version>`, or the branch name
 * when the docs come from a docs branch.
 */
export type DocsSource = { version: string; ref: DocsRef; gitRef: string; files: Map<string, string> };

function refuse(message: string): never {
  throw new CheckError([{ check: CHECK, file: 'docs', message }]);
}

function gitReason(error: unknown): string {
  const stderr: unknown = (error as { stderr?: unknown }).stderr;
  const text: string = typeof stderr === 'string' && stderr.trim() !== '' ? stderr : String(error);
  return text.trim().split('\n')[0] ?? text;
}

function runGit(library: string, args: string[]): string {
  return execFileSync('git', ['-C', library, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_OUTPUT_BYTES,
  });
}

function checkedVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) {
    refuse(`version "${version}" is not MAJOR.MINOR.PATCH`);
  }
}

/** Reads `docs/` of the library checkout in `library` as it is on disk now. */
export function readWorktreeDocs(library: string, version: string): DocsSource {
  checkedVersion(version);
  const docs: string = resolve(library, 'docs');
  if (!existsSync(docs) || !statSync(docs).isDirectory()) {
    return refuse(`${docs} is not a directory`);
  }
  const files: Map<string, string> = new Map();
  for (const entry of readdirSync(docs, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path: string = join(entry.parentPath, entry.name);
      files.set(relative(docs, path).split(sep).join('/'), readFileSync(path, 'utf8'));
    }
  }
  return { version, ref: { kind: 'worktree' }, gitRef: `v${version}`, files };
}

/** Reads every file under `docs/` at the commit `rev`, keyed by its path relative to `docs/`. */
function filesAt(library: string, rev: string): Map<string, string> {
  const names: string[] = runGit(library, ['ls-tree', '-r', '-z', '--name-only', rev, DOCS_DIR])
    .split('\0')
    .filter((name: string) => name !== '');
  const files: Map<string, string> = new Map();
  for (const name of names) {
    files.set(name.slice(DOCS_DIR.length), runGit(library, ['show', `${rev}:${name}`]));
  }
  return files;
}

/** The ref of the version's docs branch: the local branch first, then the one of `origin`; undefined when neither exists. */
function findDocsBranch(library: string, branch: string): string | undefined {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    try {
      runGit(library, ['show-ref', '--exists', ref]);
      return ref;
    } catch (error: unknown) {
      if ((error as { status?: unknown }).status !== REF_ABSENT) {
        return refuse(`docs branch ${branch} cannot be checked: ${gitReason(error)}`);
      }
    }
  }
  return undefined;
}

function commitOf(library: string, rev: string, what: string): string {
  try {
    return runGit(library, ['rev-parse', '--verify', `${rev}^{commit}`]).trim();
  } catch (error: unknown) {
    return refuse(`${what} cannot be read: ${gitReason(error)}`);
  }
}

/**
 * Reads the docs of a released version. When the version has a docs branch (`docs/v<version>`, local or on `origin`)
 * the docs come from its head, provided the release tag is an ancestor of the head and the branch changes nothing
 * outside `docs/` since the tag; a branch that breaks either rule is refused, never replaced by the tag, so no stale
 * docs are published unnoticed. Without a branch the docs come from the tag `v<version>`.
 */
export function readReleasedDocs(library: string, version: string): DocsSource {
  checkedVersion(version);
  const tag: string = `v${version}`;
  const branch: string = `docs/${tag}`;
  const tagCommit: string = commitOf(library, `refs/tags/${tag}`, `tag ${tag}`);
  const branchRef: string | undefined = findDocsBranch(library, branch);
  if (branchRef === undefined) {
    return { version, ref: { kind: 'tag', tag }, gitRef: tag, files: filesAt(library, tagCommit) };
  }
  const head: string = commitOf(library, branchRef, `the head of docs branch ${branch}`);
  try {
    runGit(library, ['merge-base', '--is-ancestor', tagCommit, head]);
  } catch (error: unknown) {
    if ((error as { status?: unknown }).status === 1) {
      return refuse(`docs branch ${branch} is refused: tag ${tag} is not an ancestor of its head ${head}`);
    }
    return refuse(`docs branch ${branch} cannot be checked: ${gitReason(error)}`);
  }
  let changed: string[];
  try {
    changed = runGit(library, ['diff', '--name-only', '--no-renames', '-z', tagCommit, head])
      .split('\0')
      .filter((path: string) => path !== '');
  } catch (error: unknown) {
    return refuse(`docs branch ${branch} cannot be checked: ${gitReason(error)}`);
  }
  const outside: string[] = changed.filter((path: string) => !path.startsWith(DOCS_DIR));
  if (outside.length > 0) {
    const listed: string = outside.slice(0, LISTED_FILES).join(', ');
    const more: string = outside.length > LISTED_FILES ? ` and ${outside.length - LISTED_FILES} more` : '';
    return refuse(`docs branch ${branch} is refused: it changes files outside docs/ since tag ${tag}: ${listed}${more}`);
  }
  return { version, ref: { kind: 'branch', name: branch, tagCommit }, gitRef: branch, files: filesAt(library, head) };
}
