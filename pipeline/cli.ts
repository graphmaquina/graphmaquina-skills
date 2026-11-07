import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { generateSkill, generatedProblems, readTemplate, repositoryProblems, writeSkill } from './generate.ts';
import { CheckError, SKILL_DIR } from './model.ts';
import type { Problem } from './model.ts';
import { PublishError, publish } from './publish.ts';
import { stampedVersion } from './skill.ts';
import { readReleasedDocs, readWorktreeDocs } from './source.ts';
import type { DocsSource } from './source.ts';

const USAGE: string = `usage:
  generate --library <dir> --version <x.y.z> --out <dir> [--worktree]
  check [--library <dir>]
  release-gate --library <dir> --version <x.y.z>
  publish --library <dir> --version <x.y.z> [--republish]`;

const OK: number = 0;
const FAILED: number = 1;
const USAGE_ERROR: number = 2;

class UsageError extends Error {}

type Options = { library?: string; version?: string; out?: string; worktree?: boolean; republish?: boolean };

function parse(args: string[]): Options {
  try {
    return parseArgs({
      args,
      options: {
        library: { type: 'string' },
        version: { type: 'string' },
        out: { type: 'string' },
        worktree: { type: 'boolean' },
        republish: { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error: unknown) {
    throw new UsageError((error as Error).message);
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new UsageError(`--${name} is required`);
  }
  return value;
}

/** Rejects the options a command does not take. */
function only(options: Options, allowed: string[]): void {
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      throw new UsageError(`--${key} is not an option of this command`);
    }
  }
}

function describe(problem: Problem): string {
  const where: string = problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`;
  return `${problem.check} ${where} ${problem.message}`;
}

function report(problems: Problem[]): number {
  for (const problem of problems) {
    console.error(describe(problem));
  }
  console.error(`${problems.length} problem(s) found`);
  return FAILED;
}

function generated(repo: string, source: DocsSource): { files: Map<string, string>; problems: Problem[] } {
  const files: Map<string, string> = generateSkill(source, readTemplate(repo));
  return { files, problems: generatedProblems(files, source.version) };
}

function generate(options: Options, repo: string): number {
  only(options, ['library', 'version', 'out', 'worktree']);
  const library: string = resolve(required(options.library, 'library'));
  const version: string = required(options.version, 'version');
  const out: string = realPath(resolve(required(options.out, 'out')));
  const fromOut: string = relative(out, realPath(repo));
  if (fromOut === '' || !(fromOut === '..' || fromOut.startsWith(`..${sep}`) || isAbsolute(fromOut))) {
    throw new UsageError(`--out ${out} is or contains the repository; pass a folder inside it`);
  }
  const source: DocsSource = options.worktree === true ? readWorktreeDocs(library, version) : readReleasedDocs(library, version);
  const { files, problems } = generated(repo, source);
  writeSkill(out, files);
  console.log(`wrote ${files.size} file(s) to ${out}`);
  return problems.length > 0 ? report(problems) : OK;
}

/** The real path of `path`, resolving symbolic links in the part that exists (the rest may not exist yet). */
function realPath(path: string): string {
  const parent: string = dirname(path);
  if (existsSync(path)) {
    return realpathSync(path);
  }
  return parent === path ? path : join(realPath(parent), relative(parent, path));
}

/** The paths of every file under `dir`, relative to it and with `/` separators. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/** K-08: the committed skill must equal what the generator produces for the stamped version. */
function differences(skillDir: string, files: Map<string, string>): Problem[] {
  const problems: Problem[] = [];
  const onDisk: string[] = filesUnder(skillDir);
  for (const path of onDisk) {
    const expected: string | undefined = files.get(path);
    if (expected === undefined) {
      problems.push({ check: 'K-08', file: path, message: 'the file is committed but the generator does not produce it' });
    } else if (!readFileSync(join(skillDir, path)).equals(Buffer.from(expected))) {
      problems.push({ check: 'K-08', file: path, message: 'the file differs from what the generator produces; run generate' });
    }
  }
  for (const path of files.keys()) {
    if (!onDisk.includes(path)) {
      problems.push({ check: 'K-08', file: path, message: 'the generator produces this file but it is not committed' });
    }
  }
  return problems;
}

function check(options: Options, repo: string): number {
  only(options, ['library']);
  const skillFile: string = join(repo, SKILL_DIR, 'SKILL.md');
  if (!existsSync(skillFile)) {
    const problems: Problem[] = repositoryProblems(repo);
    if (problems.length > 0) {
      return report(problems);
    }
    console.log('no skill has been published yet');
    return OK;
  }
  const library: string = resolve(required(options.library, 'library'));
  const version: string | undefined = stampedVersion(readFileSync(skillFile, 'utf8'));
  if (version === undefined) {
    return report([{ check: 'K-08', file: 'SKILL.md', message: 'the committed SKILL.md states no metadata.version' }]);
  }
  const { files, problems } = generated(repo, readReleasedDocs(library, version));
  const all: Problem[] = [...differences(join(repo, SKILL_DIR), files), ...problems, ...repositoryProblems(repo)];
  if (all.length > 0) {
    return report(all);
  }
  console.log(`the skill for GraphMaquina ${version} is up to date`);
  return OK;
}

function releaseGate(options: Options, repo: string): number {
  only(options, ['library', 'version']);
  const library: string = resolve(required(options.library, 'library'));
  const version: string = required(options.version, 'version');
  const { files, problems } = generated(repo, readWorktreeDocs(library, version));
  const all: Problem[] = [...problems, ...repositoryProblems(repo)];
  if (all.length > 0) {
    return report(all);
  }
  console.log(`the skill for GraphMaquina ${version} passes every check (${files.size} files)`);
  return OK;
}

function publishCommand(options: Options, repo: string): number {
  only(options, ['library', 'version', 'republish']);
  publish({
    repo,
    library: required(options.library, 'library'),
    version: required(options.version, 'version'),
    republish: options.republish === true,
    gh: process.env['GM_GH'] ?? 'gh',
  });
  console.log(`published the skill for GraphMaquina ${options.version}`);
  return OK;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const repo: string = process.cwd();
  try {
    const options: Options = parse(rest);
    switch (command) {
      case 'generate':
        return generate(options, repo);
      case 'check':
        return check(options, repo);
      case 'release-gate':
        return releaseGate(options, repo);
      case 'publish':
        return publishCommand(options, repo);
      default:
        throw new UsageError(command === undefined ? 'a command is required' : `unknown command "${command}"`);
    }
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      return USAGE_ERROR;
    }
    if (error instanceof CheckError) {
      return report(error.problems);
    }
    if (error instanceof PublishError) {
      console.error(`publish refused: ${error.message}`);
      return FAILED;
    }
    console.error(`error: ${(error as Error).message}`);
    return FAILED;
  }
}

process.exitCode = main(process.argv.slice(2));
