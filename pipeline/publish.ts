import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { generateSkill, generatedProblems, readTemplate, repositoryProblems, writeSkill } from './generate.ts';
import { CheckError, SKILL_DIR, SKILLS_REPOSITORY } from './model.ts';
import type { Problem } from './model.ts';
import { stampedVersion } from './skill.ts';
import { readReleasedDocs } from './source.ts';
import type { DocsSource } from './source.ts';

const VERSION_PATTERN: RegExp = /^\d+\.\d+\.\d+$/;
const BRANCH: string = 'main';
const REMOTE: string = 'origin';
const BUILD_DIR: string = 'build';
const SKILLS_PARENT: string = 'plugins/graphmaquina/skills';
const ZIP_ROOT: string = 'graphmaquina';
const MAX_OUTPUT_BYTES: number = 256 * 1024 * 1024;

/** What `publish` needs: the skills repository, the library checkout, the version, the mode and the `gh` binary. */
export type PublishOptions = { repo: string; library: string; version: string; republish: boolean; gh: string };

/** Thrown when `publish` refuses or fails; the message says what to do next. */
export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

function firstLine(error: unknown): string {
  const stderr: unknown = (error as { stderr?: unknown }).stderr;
  const text: string = typeof stderr === 'string' && stderr.trim() !== '' ? stderr : String(error);
  return text.trim().split('\n')[0] ?? text;
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_OUTPUT_BYTES,
  });
}

/** Runs a command and turns a failure into a `PublishError` that names the command and the `hint`. */
function runOrRefuse(command: string, args: string[], cwd: string, hint: string): string {
  try {
    return run(command, args, cwd);
  } catch (error: unknown) {
    throw new PublishError(`\`${[command, ...args].join(' ')}\` failed: ${firstLine(error)}. ${hint}`);
  }
}

/** Compares two MAJOR.MINOR.PATCH versions numerically: negative when `a` is lower, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const left: number[] = a.split('.').map(Number);
  const right: number[] = b.split('.').map(Number);
  for (let i: number = 0; i < 3; i++) {
    const difference: number = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** Whether `binary` is a file that exists, as a path or in one of the PATH directories. */
function available(binary: string): boolean {
  if (binary.includes('/')) {
    return existsSync(binary);
  }
  return (process.env['PATH'] ?? '').split(delimiter).some((dir: string) => dir !== '' && existsSync(join(dir, binary)));
}

/** Every check that must pass before anything is written; throws on the first refusal. */
function validate(options: PublishOptions): void {
  const { repo, version, republish } = options;
  const tag: string = `v${version}`;
  if (!VERSION_PATTERN.test(version)) {
    throw new PublishError(`version "${version}" is not MAJOR.MINOR.PATCH; pass a version such as 2.0.4`);
  }
  const dirty: string = runOrRefuse('git', ['status', '--porcelain'], repo, 'Check the repository.').trim();
  if (dirty !== '') {
    throw new PublishError(`the working tree is not clean; commit or stash these changes first:\n${dirty}`);
  }
  let branch: string;
  try {
    branch = run('git', ['symbolic-ref', '--short', 'HEAD'], repo).trim();
  } catch {
    branch = '(detached HEAD)';
  }
  if (branch !== BRANCH) {
    throw new PublishError(`the current branch is ${branch}; switch to ${BRANCH} before publishing`);
  }
  try {
    run('git', ['remote', 'get-url', REMOTE], repo);
  } catch {
    throw new PublishError(
      `the repository has no ${REMOTE} remote; add it with \`git remote add ${REMOTE} <url of ${SKILLS_REPOSITORY}>\` and run publish again`,
    );
  }
  runOrRefuse('git', ['fetch', REMOTE], repo, 'Check the network and the remote, then run publish again.');
  const remoteMain: string = `refs/remotes/${REMOTE}/${BRANCH}`;
  let remoteHasMain: boolean = true;
  try {
    run('git', ['rev-parse', '--verify', '--quiet', remoteMain], repo);
  } catch {
    remoteHasMain = false;
  }
  if (remoteHasMain) {
    try {
      run('git', ['merge-base', '--is-ancestor', remoteMain, 'HEAD'], repo);
    } catch {
      throw new PublishError(`local ${BRANCH} is behind ${REMOTE}/${BRANCH}; pull ${REMOTE}/${BRANCH} and run publish again`);
    }
  }

  const skillFile: string = join(repo, SKILL_DIR, 'SKILL.md');
  const stamped: string | undefined = existsSync(skillFile) ? stampedVersion(readFileSync(skillFile, 'utf8')) : undefined;
  if (republish) {
    if (stamped === undefined) {
      throw new PublishError('--republish needs a published skill, and none is stamped in this repository; publish normally first');
    }
    if (compareVersions(version, stamped) !== 0) {
      throw new PublishError(`--republish only accepts the stamped version ${stamped}, not ${version}`);
    }
  } else {
    if (stamped !== undefined && compareVersions(version, stamped) < 0) {
      throw new PublishError(`version ${version} is lower than the stamped ${stamped}; ${BRANCH} must not go back`);
    }
    if (
      run('git', ['tag', '--list', tag], repo).trim() !== '' ||
      run('git', ['ls-remote', '--tags', REMOTE, `refs/tags/${tag}`], repo).trim() !== ''
    ) {
      throw new PublishError(`the tag ${tag} already exists here or on ${REMOTE}; tags never move. Use --republish for a docs fix`);
    }
    if (stamped !== undefined && compareVersions(version, stamped) === 0) {
      throw new PublishError(`version ${version} is already the stamped one; use --republish for a docs fix`);
    }
  }
  if (!available('zip')) {
    throw new PublishError('zip was not found; install it before publishing');
  }
  if (!available(options.gh)) {
    throw new PublishError(`${options.gh} was not found; install the GitHub CLI or set GM_GH to it before publishing`);
  }
}

/**
 * Publishes the skill for one library version (spec §5.6). Everything is checked before anything is written:
 * clean tree, branch main, an `origin` that main is not behind, the version and tag rules, the docs source and
 * every check on the generated skill. Then it writes the skill, commits, tags (normal publish), zips, pushes and
 * creates the GitHub release (or, with `republish`, uploads the new zip to the existing one).
 *
 * @throws PublishError when it refuses or a step fails
 * @throws CheckError when a check finds problems
 */
export function publish(options: PublishOptions): void {
  const repo: string = resolve(options.repo);
  const { version, republish, gh } = options;
  const tag: string = `v${version}`;
  validate({ ...options, repo });

  const source: DocsSource = readReleasedDocs(resolve(options.library), version);
  const files: Map<string, string> = generateSkill(source, readTemplate(repo));
  const problems: Problem[] = [...generatedProblems(files, version), ...repositoryProblems(repo)];
  if (problems.length > 0) {
    throw new CheckError(problems);
  }

  const stuck: string = 'The skill may already be written and committed here; fix the cause, then finish by hand.';
  writeSkill(join(repo, SKILL_DIR), files);
  runOrRefuse('git', ['add', SKILL_DIR], repo, stuck);
  const staged: boolean = (() => {
    try {
      run('git', ['diff', '--cached', '--quiet'], repo);
      return false;
    } catch {
      return true;
    }
  })();
  if (staged) {
    const verb: string = republish ? 'Republish' : 'Publish';
    runOrRefuse('git', ['commit', '-m', `${verb} the skill for GraphMaquina ${version}`], repo, stuck);
  }
  if (!republish) {
    runOrRefuse('git', ['tag', '-a', tag, '-m', `skill for GraphMaquina ${version}`], repo, stuck);
  }
  const zip: string = join(repo, BUILD_DIR, `graphmaquina-skill-${version}.zip`);
  mkdirSync(join(repo, BUILD_DIR), { recursive: true });
  rmSync(zip, { force: true });
  runOrRefuse('zip', ['-r', '-X', '-q', zip, ZIP_ROOT], join(repo, SKILLS_PARENT), stuck);
  runOrRefuse('git', ['push', REMOTE, BRANCH], repo, `${stuck} Then push the tag and create the release.`);
  if (!republish) {
    runOrRefuse('git', ['push', REMOTE, tag], repo, `${stuck} Then create the release.`);
  }
  const release: string[] = republish
    ? ['release', 'upload', tag, zip, '--clobber', '--repo', SKILLS_REPOSITORY]
    : [
        'release',
        'create',
        tag,
        zip,
        '--repo',
        SKILLS_REPOSITORY,
        '--title',
        `GraphMaquina skill ${version}`,
        '--notes',
        `Skill for GraphMaquina ${version}.`,
      ];
  runOrRefuse(gh, release, repo, 'The skill is pushed; create or update the GitHub release by hand with that command.');
}
