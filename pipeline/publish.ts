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

/** Thrown when a step fails after the skill was written; the message lists the commands that finish the publish. */
export class PublishFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishFailure';
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

/** `text` as one shell word, quoted only when it needs it, so a printed command can be pasted. */
function quote(text: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function words(command: string, args: string[]): string {
  return [command, ...args].map(quote).join(' ');
}

/** One command of the write phase; `display` is what a person pastes to run it by hand from the repository root. */
type Step = { command: string; args: string[]; cwd: string; display: string; skipWhen?: () => boolean };

function step(command: string, args: string[], cwd: string, display?: string): Step {
  return { command, args, cwd, display: display ?? words(command, args) };
}

function zipPath(repo: string, version: string): string {
  return join(repo, BUILD_DIR, `graphmaquina-skill-${version}.zip`);
}

/** The steps from building the zip to the GitHub release, shared by a publish and by the advice for an interrupted one. */
function finishSteps(
  options: PublishOptions,
  release: 'create' | 'upload',
  push: { main: boolean; tag: boolean },
): Step[] {
  const { repo, version, gh } = options;
  const tag: string = `v${version}`;
  const zip: string = zipPath(repo, version);
  const parent: string = join(repo, SKILLS_PARENT);
  const steps: Step[] = [
    step(
      'zip',
      ['-r', '-X', '-q', zip, ZIP_ROOT],
      parent,
      `mkdir -p ${quote(join(repo, BUILD_DIR))} && rm -f ${quote(zip)} && cd ${quote(parent)} && ${words('zip', ['-r', '-X', '-q', zip, ZIP_ROOT])}`,
    ),
  ];
  if (push.main) {
    steps.push(step('git', ['push', REMOTE, BRANCH], repo));
  }
  if (push.tag) {
    steps.push(step('git', ['push', REMOTE, tag], repo));
  }
  steps.push(
    step(
      gh,
      release === 'upload'
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
          ],
      repo,
    ),
  );
  return steps;
}

function tagStep(options: PublishOptions): Step {
  return step('git', ['tag', '-a', `v${options.version}`, '-m', `skill for GraphMaquina ${options.version}`], options.repo);
}

function listing(steps: Step[]): string {
  return steps.map((each: Step) => `  ${each.display}`).join('\n');
}

/** Whether main has commits that origin does not (or origin has no main yet): the push of main is still to do. */
function mainNeedsPush(repo: string): boolean {
  try {
    return run('git', ['rev-list', '--count', `refs/remotes/${REMOTE}/${BRANCH}..HEAD`], repo).trim() !== '0';
  } catch {
    return true;
  }
}

/** The refusal for a version whose publish did not get as far as its release; lists the commands that finish it. */
function interrupted(options: PublishOptions, why: string, tagExistsHere: boolean): PublishError {
  const steps: Step[] = [
    ...(tagExistsHere ? [] : [tagStep(options)]),
    ...finishSteps(options, 'create', { main: mainNeedsPush(options.repo), tag: true }),
  ];
  return new PublishError(
    `${why}. If an earlier publish was interrupted, finish it from ${options.repo} with:\n${listing(steps)}` +
      (tagExistsHere ? `\nIf the tag is not from an interrupted publish, delete it with \`git tag -d v${options.version}\` and run publish again.` : ''),
  );
}

/** Why `gh release view` found no GitHub release for the version's tag, or undefined when the release exists. */
function missingRelease(options: PublishOptions): string | undefined {
  try {
    run(options.gh, ['release', 'view', `v${options.version}`, '--repo', SKILLS_REPOSITORY], options.repo);
    return undefined;
  } catch (error: unknown) {
    return firstLine(error);
  }
}

/**
 * The refusal for a version whose tag is on origin but whose GitHub release is missing: lists the commands that
 * create the release, building the zip first when it is not there.
 */
function releaseMissing(options: PublishOptions, reason: string, why: string, then: string): PublishError {
  const { repo, version, gh } = options;
  const steps: Step[] = finishSteps(options, 'create', { main: mainNeedsPush(repo), tag: false }).filter(
    (each: Step) => each.command !== 'zip' || !existsSync(zipPath(repo, version)),
  );
  const view: string = words(gh, ['release', 'view', `v${version}`, '--repo', SKILLS_REPOSITORY]);
  return new PublishError(
    `${why} (\`${view}\` failed: ${reason}), so an earlier publish stopped before its release. ` +
      `Finish it from ${repo} with:\n${listing(steps)}${then}`,
  );
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

  if (!available('zip')) {
    throw new PublishError('zip was not found; install it before publishing');
  }
  if (!available(options.gh)) {
    throw new PublishError(`${options.gh} was not found; install the GitHub CLI or set GM_GH to it before publishing`);
  }

  const skillFile: string = join(repo, SKILL_DIR, 'SKILL.md');
  const stamped: string | undefined = existsSync(skillFile) ? stampedVersion(readFileSync(skillFile, 'utf8')) : undefined;
  const localTag: boolean = run('git', ['tag', '--list', tag], repo).trim() !== '';
  const remoteTag: boolean = run('git', ['ls-remote', '--tags', REMOTE, `refs/tags/${tag}`], repo).trim() !== '';
  if (republish) {
    if (stamped === undefined) {
      throw new PublishError('--republish needs a published skill, and none is stamped in this repository; publish normally first');
    }
    if (compareVersions(version, stamped) !== 0) {
      throw new PublishError(`--republish only accepts the stamped version ${stamped}, not ${version}`);
    }
    if (!remoteTag) {
      throw interrupted(
        options,
        `the tag ${tag} is not on ${REMOTE}, so ${version} has no GitHub release to update`,
        localTag,
      );
    }
    const reason: string | undefined = missingRelease(options);
    if (reason !== undefined) {
      throw releaseMissing(
        options,
        reason,
        `the tag ${tag} is on ${REMOTE} but has no GitHub release to update`,
        '\nThen run publish --republish again.',
      );
    }
  } else {
    if (stamped !== undefined && compareVersions(version, stamped) < 0) {
      throw new PublishError(`version ${version} is lower than the stamped ${stamped}; ${BRANCH} must not go back`);
    }
    if (remoteTag) {
      const reason: string | undefined =
        stamped !== undefined && compareVersions(version, stamped) === 0 ? missingRelease(options) : undefined;
      if (reason !== undefined) {
        throw releaseMissing(options, reason, `the tag ${tag} is already on ${REMOTE} but has no GitHub release`, '');
      }
      throw new PublishError(`the tag ${tag} is already on ${REMOTE}; tags never move. Use --republish for a docs fix`);
    }
    if (localTag) {
      throw interrupted(options, `the tag ${tag} exists only in this repository and not on ${REMOTE}`, true);
    }
    if (stamped !== undefined && compareVersions(version, stamped) === 0) {
      throw interrupted(options, `version ${version} is already the stamped one but has no tag`, false);
    }
  }
}

function stagedChanges(repo: string): boolean {
  try {
    run('git', ['diff', '--cached', '--quiet'], repo);
    return false;
  } catch {
    return true;
  }
}

/**
 * Publishes the skill for one library version (spec §5.6). Everything is checked before anything is written:
 * clean tree, branch main, an `origin` that main is not behind, the version and tag rules (with, for a tag already on
 * `origin`, its GitHub release), the docs source and every check on the generated skill. Then it writes the skill,
 * commits, tags (normal publish), zips, pushes and creates the GitHub release (or, with `republish`, uploads the new
 * zip to the existing one).
 *
 * @throws PublishError when it refuses before writing anything
 * @throws PublishFailure when a step fails after writing; its message lists the commands that finish the publish
 * @throws CheckError when a check finds problems
 */
export function publish(options: PublishOptions): void {
  const repo: string = resolve(options.repo);
  const { version, republish } = options;
  const resolved: PublishOptions = { ...options, repo };
  validate(resolved);

  const source: DocsSource = readReleasedDocs(resolve(options.library), version);
  const files: Map<string, string> = generateSkill(source, readTemplate(repo));
  const problems: Problem[] = [...generatedProblems(files, version), ...repositoryProblems(repo)];
  if (problems.length > 0) {
    throw new CheckError(problems);
  }

  writeSkill(join(repo, SKILL_DIR), files);
  const verb: string = republish ? 'Republish' : 'Publish';
  const steps: Step[] = [
    step('git', ['add', SKILL_DIR], repo),
    {
      ...step('git', ['commit', '-m', `${verb} the skill for GraphMaquina ${version}`], repo),
      skipWhen: (): boolean => !stagedChanges(repo),
    },
    ...(republish ? [] : [tagStep(resolved)]),
    ...finishSteps(resolved, republish ? 'upload' : 'create', { main: true, tag: !republish }),
  ];
  const skipped: Set<Step> = new Set();
  for (const [index, each] of steps.entries()) {
    if (each.skipWhen?.() === true) {
      skipped.add(each);
      continue;
    }
    if (each.command === 'zip') {
      // the folder must exist and an older zip must not be updated in place
      mkdirSync(join(repo, BUILD_DIR), { recursive: true });
      rmSync(zipPath(repo, version), { force: true });
    }
    try {
      run(each.command, each.args, each.cwd);
    } catch (error: unknown) {
      const remaining: Step[] = steps.slice(index).filter((later: Step) => !skipped.has(later));
      throw new PublishFailure(
        `\`${each.display}\` failed: ${firstLine(error)}\n` +
          `The publish stopped here and what was done stays done. Fix the cause, then run from ${repo}:\n${listing(remaining)}`,
      );
    }
  }
}
