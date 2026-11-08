import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** The real repository, whose pipeline the tests run and whose manifests they copy. */
export const HOME: string = resolve(import.meta.dirname, '../..');
const CLI: string = join(HOME, 'pipeline', 'cli.ts');

export const VERSION: string = '2.0.4';
export const SKILL: string = 'plugins/graphmaquina/skills/graphmaquina';

const TEMPLATE: string = [
  '---',
  'name: graphmaquina',
  'description: Build state machines with GraphMaquina.',
  'compatibility: GraphMaquina {{version}}, Java 21.',
  'metadata:',
  '  version: "{{version}}"',
  '---',
  '',
  '# GraphMaquina {{version}}',
  '',
  'Read [the guide](references/guide.md#overview) and see SG101. Call `StateGraph`.',
  '',
].join('\n');

const DOCS: [string, string][] = [
  ['README.md', '# Docs\n\n- [Guide](guide.md)\n- [Diagnostics](diagnostics.md)\n'],
  ['guide.md', '# Guide\n\n## Overview\n\nUse StateGraph here.\n'],
  ['diagnostics.md', '# Diagnostics\n\n| SG101 | text |\n'],
];

const dirs: string[] = [];

export function cleanUp(): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function temporary(prefix: string): string {
  const dir: string = mkdtempSync(join(tmpdir(), `gm-skills-${prefix}-`));
  dirs.push(dir);
  return dir;
}

export function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Identity and signing for a test repository, local to it so the user's global git config is not involved. */
function configure(root: string): void {
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'tag.gpgsign', 'false');
}

/** A library repository with `docs/` and the tag v2.0.4 on main. */
export function library(): string {
  const root: string = temporary('library');
  git(root, 'init', '-q', '-b', 'main');
  configure(root);
  for (const [name, text] of DOCS) {
    put(root, `docs/${name}`, text);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'release');
  git(root, 'tag', '-a', `v${VERSION}`, '-m', `v${VERSION}`);
  return root;
}

/** A skills repository on main with the real manifests, a fixture template and a bare `origin` it has pushed to. */
export function skillsRepo(): { repo: string; origin: string } {
  const repo: string = temporary('repo');
  const origin: string = temporary('origin');
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'init', '-q', '-b', 'main');
  configure(repo);
  cpSync(join(HOME, '.claude-plugin'), join(repo, '.claude-plugin'), { recursive: true });
  cpSync(join(HOME, 'plugins/graphmaquina/.claude-plugin'), join(repo, 'plugins/graphmaquina/.claude-plugin'), {
    recursive: true,
  });
  put(repo, 'template/SKILL.md', TEMPLATE);
  put(repo, '.gitignore', 'build/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'start');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
  return { repo, origin };
}

export type CliResult = { status: number | null; stdout: string; stderr: string };

/** Runs `node pipeline/cli.ts` with `repo` as the working directory. */
export function cli(repo: string, args: string[], env: Record<string, string> = {}): CliResult {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The paths of a `gh` stand-in: the binary, its log, and the marker files of the releases it holds. */
export type FakeGh = { gh: string; log: string; releases: string; failCreate: string };

/**
 * A `gh` stand-in. `release view <tag>` writes nothing and succeeds only when `releases/<tag>` exists, as real gh
 * does for a release that exists. Every other call appends its arguments, on one line, to the log file;
 * `release create <tag>` then creates `releases/<tag>`, or fails while the `failCreate` file exists, and
 * `release upload <tag>` fails when `releases/<tag>` does not exist.
 */
export function fakeGh(): FakeGh {
  const dir: string = temporary('gh');
  const gh: string = join(dir, 'gh');
  const log: string = join(dir, 'gh.log');
  const releases: string = join(dir, 'releases');
  const failCreate: string = join(dir, 'fail-create');
  mkdirSync(releases);
  writeFileSync(
    gh,
    [
      '#!/bin/sh',
      'if [ "$1 $2" = "release view" ]; then',
      `  [ -f "${releases}/$3" ] && exit 0`,
      "  echo 'release not found' >&2; exit 1",
      'fi',
      `printf '%s\\n' "$*" >> "${log}"`,
      'if [ "$1 $2" = "release create" ]; then',
      `  [ -f "${failCreate}" ] && { echo 'HTTP 502: Bad Gateway' >&2; exit 1; }`,
      `  : > "${releases}/$3"`,
      'fi',
      'if [ "$1 $2" = "release upload" ]; then',
      `  [ -f "${releases}/$3" ] || { echo 'release not found' >&2; exit 1; }`,
      'fi',
      '',
    ].join('\n'),
  );
  chmodSync(gh, 0o755);
  return { gh, log, releases, failCreate };
}
