import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckError } from '../../pipeline/model.ts';
import type { Problem } from '../../pipeline/model.ts';
import { readReleasedDocs, readWorktreeDocs } from '../../pipeline/source.ts';

const VERSION: string = '2.0.4';
const TAG: string = 'v2.0.4';
const BRANCH: string = 'docs/v2.0.4';

const dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function commit(root: string, message: string): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

/** A repository with `docs/README.md`, `docs/a.md`, `docs/images/README.md` and `pom.txt`, tagged v2.0.4 on main. */
function library(): string {
  const root: string = mkdtempSync(join(tmpdir(), 'gm-skills-source-'));
  dirs.push(root);
  git(root, 'init', '-q', '-b', 'main');
  put(root, 'docs/README.md', 'readme');
  put(root, 'docs/a.md', 'a at tag');
  put(root, 'docs/images/README.md', 'images');
  put(root, 'pom.txt', 'pom');
  commit(root, 'release');
  git(root, 'tag', '-a', TAG, '-m', TAG);
  return root;
}

/** Creates `docs/v2.0.4` from the tag, applies `edit` and returns to main. */
function docsBranch(root: string, edit: () => void): void {
  git(root, 'switch', '-q', '-c', BRANCH, TAG);
  edit();
  commit(root, 'docs');
  git(root, 'switch', '-q', 'main');
}

function problemsOf(action: () => unknown): Problem[] {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CheckError);
    return (error as CheckError).problems;
  }
  throw new Error('expected a CheckError');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('library docs source', () => {
  it('reads the working tree', () => {
    const root: string = library();
    put(root, 'docs/a.md', 'a in the working tree');
    const source = readWorktreeDocs(root, VERSION);
    expect(source.ref).toEqual({ kind: 'worktree' });
    expect(source.gitRef).toBe(TAG);
    expect(source.version).toBe(VERSION);
    expect(source.files.get('a.md')).toBe('a in the working tree');
    expect([...source.files.keys()].sort()).toEqual(['README.md', 'a.md', 'images/README.md']);
  });

  it('reads the tag when there is no docs branch', () => {
    const root: string = library();
    put(root, 'docs/a.md', 'a in the working tree');
    const source = readReleasedDocs(root, VERSION);
    expect(source.ref).toEqual({ kind: 'tag', tag: TAG });
    expect(source.gitRef).toBe(TAG);
    expect(source.files.get('a.md')).toBe('a at tag');
    expect([...source.files.keys()].sort()).toEqual(['README.md', 'a.md', 'images/README.md']);
  });

  it('prefers a local docs branch that changes only docs/', () => {
    const root: string = library();
    docsBranch(root, () => put(root, 'docs/a.md', 'a on the branch'));
    const source = readReleasedDocs(root, VERSION);
    expect(source.ref.kind).toBe('branch');
    expect(source.gitRef).toBe(BRANCH);
    expect(source.files.get('a.md')).toBe('a on the branch');
    expect(source.ref).toMatchObject({ kind: 'branch', name: BRANCH, tagCommit: git(root, 'rev-parse', `${TAG}^{commit}`).trim() });
  });

  it('falls back to origin/docs/v2.0.4 when there is no local branch', () => {
    const origin: string = library();
    docsBranch(origin, () => put(origin, 'docs/a.md', 'a on the remote branch'));
    const clone: string = mkdtempSync(join(tmpdir(), 'gm-skills-source-clone-'));
    dirs.push(clone);
    git(origin, 'clone', '-q', origin, clone);
    expect(() => git(clone, 'show-ref', '--exists', `refs/heads/${BRANCH}`)).toThrow();
    const source = readReleasedDocs(clone, VERSION);
    expect(source.ref.kind).toBe('branch');
    expect(source.gitRef).toBe(BRANCH);
    expect(source.files.get('a.md')).toBe('a on the remote branch');
  });

  it('refuses a docs branch that changes a file outside docs/', () => {
    const root: string = library();
    docsBranch(root, () => {
      put(root, 'docs/a.md', 'a on the branch');
      put(root, 'pom.txt', 'changed pom');
    });
    const problems: Problem[] = problemsOf(() => readReleasedDocs(root, VERSION));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('outside docs/');
    expect(problems[0]?.message).toContain('pom.txt');
  });

  it('refuses a docs branch whose tag is not an ancestor', () => {
    const root: string = library();
    git(root, 'switch', '-q', '--orphan', BRANCH);
    put(root, 'docs/README.md', 'unrelated');
    commit(root, 'unrelated history');
    git(root, 'switch', '-q', 'main');
    const problems: Problem[] = problemsOf(() => readReleasedDocs(root, VERSION));
    expect(problems[0]?.message).toContain('not an ancestor');
  });

  it('fails when the tag is missing', () => {
    const root: string = library();
    git(root, 'tag', '-d', TAG);
    const problems: Problem[] = problemsOf(() => readReleasedDocs(root, VERSION));
    expect(problems[0]?.message).toContain(TAG);
  });

  it('refuses a version that is not MAJOR.MINOR.PATCH', () => {
    const root: string = library();
    for (const bad of ['2.0', 'v2.0.4', '2.0.4-rc1', '2.0.x', '']) {
      expect(problemsOf(() => readReleasedDocs(root, bad))).toHaveLength(1);
      expect(problemsOf(() => readWorktreeDocs(root, bad))).toHaveLength(1);
    }
  });
});
