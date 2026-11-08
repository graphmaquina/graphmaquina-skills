import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersions } from '../../pipeline/publish.ts';
import { cleanUp, cli, fakeGh, git, library, put, SKILL, skillsRepo, temporary, VERSION } from '../helpers/repo.ts';
import type { CliResult, FakeGh } from '../helpers/repo.ts';
import { execFileSync } from 'node:child_process';

vi.setConfig({ testTimeout: 60000 });

afterEach(cleanUp);

type Setup = { repo: string; origin: string; lib: string; gh: FakeGh };

function setup(): Setup {
  return { ...skillsRepo(), lib: library(), gh: fakeGh() };
}

function publishCli(s: Setup, ...extra: string[]): CliResult {
  return cli(s.repo, ['publish', '--library', s.lib, '--version', VERSION, ...extra], { GM_GH: s.gh.gh });
}

function ghLog(s: Setup): string {
  return existsSync(s.gh.log) ? readFileSync(s.gh.log, 'utf8') : '';
}

/** The repository state a refused publish must leave as it was. */
function snapshot(s: Setup): string {
  return [
    git(s.repo, 'rev-parse', 'HEAD'),
    git(s.repo, 'tag', '--list'),
    git(s.repo, 'status', '--porcelain'),
    existsSync(join(s.repo, 'build')) ? 'build' : 'no build',
    ghLog(s),
  ].join('|');
}

/** Runs `attempt`, which must exit 1 naming `text` and leave the repository exactly as the snapshot taken before it. */
function expectRefused(s: Setup, attempt: () => CliResult, text: string): CliResult {
  const before: string = snapshot(s);
  const result: CliResult = attempt();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(text);
  expect(result.stderr).not.toContain('publish failed');
  expect(snapshot(s)).toBe(before);
  return result;
}

/** Publishes 2.0.4 normally, so the repository is stamped; returns the setup with a clean gh log. */
function published(): Setup {
  const s: Setup = setup();
  expect(publishCli(s).status).toBe(0);
  return s;
}

describe('publish', () => {
  it('commits, tags v2.0.4, pushes main and the tag and creates the release', () => {
    const s: Setup = setup();
    const result: CliResult = publishCli(s);
    expect(result.status, result.stderr).toBe(0);
    expect(git(s.repo, 'log', '-1', '--format=%s').trim()).toBe('Publish the skill for GraphMaquina 2.0.4');
    expect(git(s.repo, 'tag', '-n1', '--list', 'v2.0.4')).toContain('skill for GraphMaquina 2.0.4');
    expect(git(s.repo, 'cat-file', '-t', 'v2.0.4').trim()).toBe('tag');
    expect(git(s.origin, 'rev-parse', 'refs/heads/main')).toBe(git(s.repo, 'rev-parse', 'HEAD'));
    expect(git(s.origin, 'tag', '--list')).toBe('v2.0.4\n');
    expect(git(s.repo, 'status', '--porcelain')).toBe('');
    const log: string = ghLog(s);
    expect(log).toContain('release create v2.0.4');
    expect(log).toContain('graphmaquina-skill-2.0.4.zip');
    expect(log).toContain('--repo graphmaquina/skills');
    expect(log).toContain('--title GraphMaquina skill 2.0.4');
    expect(log).toContain('--notes Skill for GraphMaquina 2.0.4.');
  });

  it('the zip holds graphmaquina/SKILL.md at its root', () => {
    const s: Setup = published();
    const listing: string = execFileSync('unzip', ['-l', join(s.repo, 'build/graphmaquina-skill-2.0.4.zip')], { encoding: 'utf8' });
    expect(listing).toContain('graphmaquina/SKILL.md');
    expect(listing).toContain('graphmaquina/references/README.md');
    expect(listing).not.toContain('plugins/');
  });

  it('refuses a dirty working tree', () => {
    const s: Setup = setup();
    put(s.repo, 'notes.txt', 'stray');
    expectRefused(s, () => publishCli(s), 'working tree is not clean');
    expect(existsSync(join(s.repo, SKILL))).toBe(false);
  });

  it('refuses a local main behind origin/main', () => {
    const s: Setup = setup();
    const other: string = temporary('other');
    git(other, 'clone', '-q', s.origin, '.');
    git(other, 'config', 'user.name', 'Test');
    git(other, 'config', 'user.email', 't@example.com');
    put(other, 'news.txt', 'new');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'news');
    git(other, 'push', '-q', 'origin', 'main');
    expectRefused(s, () => publishCli(s), 'behind origin/main');
    expect(existsSync(join(s.repo, SKILL))).toBe(false);
  });

  it('refuses any branch other than main', () => {
    const s: Setup = setup();
    git(s.repo, 'switch', '-q', '-c', 'work');
    expectRefused(s, () => publishCli(s), 'current branch is work');
  });

  it('refuses, asking to add the remote, when there is no origin', () => {
    const s: Setup = setup();
    git(s.repo, 'remote', 'remove', 'origin');
    expectRefused(s, () => publishCli(s), 'git remote add origin');
    expect(existsSync(join(s.repo, SKILL))).toBe(false);
  });

  it('allows the first publish when origin has no main yet', () => {
    const s: Setup = setup();
    git(s.origin, 'update-ref', '-d', 'refs/heads/main');
    git(s.repo, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(publishCli(s).status).toBe(0);
    expect(git(s.origin, 'rev-parse', 'refs/heads/main')).toBe(git(s.repo, 'rev-parse', 'HEAD'));
  });

  it('publishes the first version to an empty origin that has never received a push', () => {
    const s: Setup = setup();
    const empty: string = temporary('empty');
    git(empty, 'init', '-q', '--bare', '-b', 'main');
    git(s.repo, 'remote', 'set-url', 'origin', empty);
    git(s.repo, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(git(empty, 'for-each-ref')).toBe('');
    expect(git(s.repo, 'for-each-ref', 'refs/remotes')).toBe('');
    const result: CliResult = publishCli(s);
    expect(result.status, result.stderr).toBe(0);
    expect(git(empty, 'rev-parse', 'refs/heads/main')).toBe(git(s.repo, 'rev-parse', 'HEAD'));
    expect(git(empty, 'tag', '--list')).toBe('v2.0.4\n');
    expect(ghLog(s)).toContain('release create v2.0.4');
  });

  it('refuses a tag that is already on origin', () => {
    const s: Setup = setup();
    const other: string = temporary('other');
    git(other, 'clone', '-q', s.origin, '.');
    git(other, 'config', 'user.name', 'Test');
    git(other, 'config', 'user.email', 't@example.com');
    git(other, 'tag', 'v2.0.4');
    git(other, 'push', '-q', 'origin', 'v2.0.4');
    git(s.repo, 'fetch', '-q', 'origin'); // publish fetches too; doing it first keeps its tag out of the snapshot
    expectRefused(s, () => publishCli(s), 'v2.0.4 is already on origin');
  });

  it('refuses a tag that exists only locally, listing the commands that finish the publish', () => {
    const s: Setup = setup();
    git(s.repo, 'tag', 'v2.0.4');
    const result: CliResult = expectRefused(s, () => publishCli(s), 'v2.0.4 exists only in this repository');
    expect(result.stderr).toContain('git push origin v2.0.4');
    expect(result.stderr).toContain('release create v2.0.4');
    expect(result.stderr).toContain('git tag -d v2.0.4');
  });

  it('refuses the stamped version without --republish when it has an origin tag', () => {
    const s: Setup = published();
    expectRefused(s, () => publishCli(s), 'Use --republish');
  });

  it('refuses a version lower than the stamped one', () => {
    const s: Setup = published();
    expectRefused(
      s,
      () => cli(s.repo, ['publish', '--library', s.lib, '--version', '2.0.3'], { GM_GH: s.gh.gh }),
      'lower than the stamped 2.0.4',
    );
  });

  it('refuses the stamped version without --republish', () => {
    const s: Setup = published();
    git(s.repo, 'tag', '-d', 'v2.0.4');
    git(s.repo, 'push', '-q', 'origin', '--delete', 'v2.0.4');
    const result: CliResult = expectRefused(s, () => publishCli(s), 'already the stamped one but has no tag');
    expect(result.stderr).toContain('git tag -a v2.0.4');
  });

  it('refuses a problem in the generated skill before writing anything', () => {
    const s: Setup = setup();
    put(s.lib, 'docs/guide.md', '# Guide\n\nNo overview heading.\n');
    git(s.lib, 'add', '-A');
    git(s.lib, 'commit', '-q', '-m', 'docs');
    git(s.lib, 'tag', '-f', '-a', 'v2.0.4', '-m', 'v2.0.4');
    expectRefused(s, () => publishCli(s), 'K-03');
    expect(existsSync(join(s.repo, SKILL))).toBe(false);
  });
});

describe('republish', () => {
  it('refuses a version other than the stamped one', () => {
    const s: Setup = published();
    expectRefused(
      s,
      () => cli(s.repo, ['publish', '--library', s.lib, '--version', '2.0.5', '--republish'], { GM_GH: s.gh.gh }),
      'only accepts the stamped version 2.0.4',
    );
  });

  it('refuses when nothing is stamped', () => {
    const s: Setup = setup();
    expectRefused(s, () => publishCli(s, '--republish'), 'publish normally first');
  });

  it('commits without a tag and uploads with --clobber', () => {
    const s: Setup = published();
    const tagBefore: string = git(s.repo, 'rev-parse', 'v2.0.4');
    put(s.lib, 'docs/guide.md', '# Guide\n\n## Overview\n\nUse StateGraph, fixed.\n');
    git(s.lib, 'switch', '-q', '-c', 'docs/v2.0.4', 'v2.0.4');
    git(s.lib, 'add', '-A');
    git(s.lib, 'commit', '-q', '-m', 'docs fix');
    git(s.lib, 'switch', '-q', 'main');
    const result: CliResult = publishCli(s, '--republish');
    expect(result.status, result.stderr).toBe(0);
    expect(git(s.repo, 'log', '-1', '--format=%s').trim()).toBe('Republish the skill for GraphMaquina 2.0.4');
    expect(git(s.repo, 'rev-parse', 'v2.0.4')).toBe(tagBefore);
    expect(git(s.origin, 'rev-parse', 'refs/heads/main')).toBe(git(s.repo, 'rev-parse', 'HEAD'));
    expect(readFileSync(join(s.repo, SKILL, 'references/guide.md'), 'utf8')).toContain('fixed');
    const log: string = ghLog(s);
    expect(log).toContain('release upload v2.0.4');
    expect(log).toContain('--clobber');
    expect(log).toContain('--repo graphmaquina/skills');
    expect(log.match(/release create/g)).toHaveLength(1);
  });
});

describe('republish without a release', () => {
  it('refuses when the tag is not on origin and nothing is written', () => {
    const s: Setup = published();
    git(s.origin, 'update-ref', '-d', 'refs/tags/v2.0.4');
    const result: CliResult = expectRefused(
      s,
      () => publishCli(s, '--republish'),
      'tag v2.0.4 is not on origin',
    );
    expect(result.stderr).toContain('git push origin v2.0.4');
  });
});

describe('an interrupted publish', () => {
  /** Origin accepts fetches but rejects every push. */
  function rejectPushes(s: Setup): string {
    const hook: string = join(s.origin, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    return hook;
  }

  it('lists the exact commands, shell-quoted, and they finish the publish', () => {
    const s: Setup = setup();
    const hook: string = rejectPushes(s);
    const result: CliResult = publishCli(s);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('publish failed');
    expect(result.stderr).not.toContain('refused');
    expect(git(s.repo, 'cat-file', '-t', 'v2.0.4').trim()).toBe('tag');
    expect(ghLog(s)).toBe('');
    const commands: string[] = result.stderr
      .split('\n')
      .filter((line: string) => line.startsWith('  '))
      .map((line: string) => line.trim());
    expect(commands[0]).toBe('git push origin main');
    expect(commands[1]).toBe('git push origin v2.0.4');
    expect(commands[2]).toContain("--title 'GraphMaquina skill 2.0.4' --notes 'Skill for GraphMaquina 2.0.4.'");
    expect(commands).toHaveLength(3);

    rmSync(hook);
    for (const command of commands) {
      execFileSync('sh', ['-c', command], { cwd: s.repo, stdio: 'pipe' });
    }
    expect(git(s.origin, 'tag', '--list')).toBe('v2.0.4\n');
    expect(git(s.origin, 'rev-parse', 'refs/heads/main')).toBe(git(s.repo, 'rev-parse', 'HEAD'));
    expect(ghLog(s)).toContain('release create v2.0.4');
  });

  it('is answered by the rerun with the local-only tag case and the same commands', () => {
    const s: Setup = setup();
    rejectPushes(s);
    expect(publishCli(s).status).toBe(1);
    const result: CliResult = expectRefused(s, () => publishCli(s), 'v2.0.4 exists only in this repository');
    expect(result.stderr).toContain('git push origin main');
    expect(result.stderr).toContain('git push origin v2.0.4');
    expect(result.stderr).toContain('release create v2.0.4');
    expect(result.stderr).toContain("'GraphMaquina skill 2.0.4'");
    const republished: CliResult = expectRefused(s, () => publishCli(s, '--republish'), 'tag v2.0.4 is not on origin');
    expect(republished.stderr).toContain('git push origin v2.0.4');
  });
});

describe('a tag on origin without its GitHub release', () => {
  /** Publishes 2.0.4 with a failing `gh release create`: main and the tag reach origin, the release does not exist. */
  function stoppedBeforeRelease(): Setup {
    const s: Setup = setup();
    writeFileSync(s.gh.failCreate, '');
    const result: CliResult = publishCli(s);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('publish failed');
    expect(commands(result)).toHaveLength(1);
    expect(commands(result)[0]).toContain('release create v2.0.4');
    expect(git(s.origin, 'tag', '--list')).toBe('v2.0.4\n');
    expect(git(s.origin, 'rev-parse', 'refs/heads/main')).toBe(git(s.repo, 'rev-parse', 'HEAD'));
    rmSync(s.gh.failCreate);
    return s;
  }

  function commands(result: CliResult): string[] {
    return result.stderr
      .split('\n')
      .filter((line: string) => line.startsWith('  '))
      .map((line: string) => line.trim());
  }

  function runAll(s: Setup, listed: string[]): void {
    for (const command of listed) {
      execFileSync('sh', ['-c', command], { cwd: s.repo, stdio: 'pipe' });
    }
  }

  it('refuses the rerun with the gh release create that finishes it, and nothing is written', () => {
    const s: Setup = stoppedBeforeRelease();
    const result: CliResult = expectRefused(s, () => publishCli(s), 'v2.0.4 is already on origin but has no GitHub release');
    expect(result.stderr).toContain('release view v2.0.4 --repo graphmaquina/skills` failed: release not found');
    expect(result.stderr).not.toContain('--republish');
    const listed: string[] = commands(result);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toContain('release create v2.0.4');
    expect(listed[0]).toContain('graphmaquina-skill-2.0.4.zip --repo graphmaquina/skills');
    expect(listed[0]).toContain("--title 'GraphMaquina skill 2.0.4' --notes 'Skill for GraphMaquina 2.0.4.'");

    runAll(s, listed);
    expect(existsSync(join(s.gh.releases, 'v2.0.4'))).toBe(true);
    expectRefused(s, () => publishCli(s), 'Use --republish');
  });

  it('lists the zip build first when the zip is gone, and the commands create the release', () => {
    const s: Setup = stoppedBeforeRelease();
    rmSync(join(s.repo, 'build'), { recursive: true });
    const result: CliResult = expectRefused(s, () => publishCli(s), 'v2.0.4 is already on origin but has no GitHub release');
    const listed: string[] = commands(result);
    expect(listed).toHaveLength(2);
    expect(listed[0]).toContain('zip -r -X -q');
    expect(listed[1]).toContain('release create v2.0.4');

    runAll(s, listed);
    expect(execFileSync('unzip', ['-l', join(s.repo, 'build/graphmaquina-skill-2.0.4.zip')], { encoding: 'utf8' })).toContain(
      'graphmaquina/SKILL.md',
    );
    expect(existsSync(join(s.gh.releases, 'v2.0.4'))).toBe(true);
  });

  it('refuses --republish, which has no release to upload to, and nothing is written', () => {
    const s: Setup = stoppedBeforeRelease();
    const result: CliResult = expectRefused(
      s,
      () => publishCli(s, '--republish'),
      'v2.0.4 is on origin but has no GitHub release to update',
    );
    expect(commands(result)).toHaveLength(1);
    expect(commands(result)[0]).toContain('release create v2.0.4');
    expect(result.stderr).toContain('Then run publish --republish again.');
    expect(ghLog(s)).not.toContain('release upload');
  });
});

describe('compareVersions', () => {
  it('compares numerically per part', () => {
    expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.0', '2.0.99')).toBeGreaterThan(0);
    expect(compareVersions('2.0.4', '2.0.4')).toBe(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
  });
});
