import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersions } from '../../pipeline/publish.ts';
import { cleanUp, cli, fakeGh, git, library, put, SKILL, skillsRepo, temporary, VERSION } from '../helpers/repo.ts';
import type { CliResult } from '../helpers/repo.ts';
import { execFileSync } from 'node:child_process';

vi.setConfig({ testTimeout: 60000 });

afterEach(cleanUp);

type Setup = { repo: string; origin: string; lib: string; gh: { gh: string; log: string } };

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

function expectRefused(s: Setup, result: CliResult, before: string, text: string): void {
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(text);
  expect(snapshot(s)).toBe(before);
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
    const before: string = snapshot(s);
    expectRefused(s, publishCli(s), before, 'working tree is not clean');
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
    const before: string = snapshot(s);
    expectRefused(s, publishCli(s), before, 'behind origin/main');
    expect(existsSync(join(s.repo, SKILL))).toBe(false);
  });

  it('refuses any branch other than main', () => {
    const s: Setup = setup();
    git(s.repo, 'switch', '-q', '-c', 'work');
    const before: string = snapshot(s);
    expectRefused(s, publishCli(s), before, 'current branch is work');
  });

  it('refuses, asking to add the remote, when there is no origin', () => {
    const s: Setup = setup();
    git(s.repo, 'remote', 'remove', 'origin');
    const before: string = snapshot(s);
    const result: CliResult = publishCli(s);
    expectRefused(s, result, before, 'git remote add origin');
    expect(existsSync(join(s.repo, SKILL))).toBe(false);
  });

  it('allows the first publish when origin has no main yet', () => {
    const s: Setup = setup();
    git(s.origin, 'update-ref', '-d', 'refs/heads/main');
    git(s.repo, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(publishCli(s).status).toBe(0);
    expect(git(s.origin, 'rev-parse', 'refs/heads/main')).toBe(git(s.repo, 'rev-parse', 'HEAD'));
  });

  it('refuses an existing tag, local or only on origin', () => {
    const local: Setup = setup();
    git(local.repo, 'tag', 'v2.0.4');
    expectRefused(local, publishCli(local), snapshot(local), 'v2.0.4 already exists');

    const remote: Setup = setup();
    const other: string = temporary('other');
    git(other, 'clone', '-q', remote.origin, '.');
    git(other, 'config', 'user.name', 'Test');
    git(other, 'config', 'user.email', 't@example.com');
    git(other, 'tag', 'v2.0.4');
    git(other, 'push', '-q', 'origin', 'v2.0.4');
    expectRefused(remote, publishCli(remote), snapshot(remote), 'v2.0.4 already exists');
  });

  it('refuses a version lower than the stamped one', () => {
    const s: Setup = published();
    const before: string = snapshot(s);
    const result: CliResult = cli(s.repo, ['publish', '--library', s.lib, '--version', '2.0.3'], { GM_GH: s.gh.gh });
    expectRefused(s, result, before, 'lower than the stamped 2.0.4');
  });

  it('refuses the stamped version without --republish', () => {
    const s: Setup = published();
    git(s.repo, 'tag', '-d', 'v2.0.4');
    git(s.repo, 'push', '-q', 'origin', '--delete', 'v2.0.4');
    const before: string = snapshot(s);
    expectRefused(s, publishCli(s), before, 'use --republish');
  });

  it('refuses a problem in the generated skill before writing anything', () => {
    const s: Setup = setup();
    put(s.lib, 'docs/guide.md', '# Guide\n\nNo overview heading.\n');
    git(s.lib, 'add', '-A');
    git(s.lib, 'commit', '-q', '-m', 'docs');
    git(s.lib, 'tag', '-f', '-a', 'v2.0.4', '-m', 'v2.0.4');
    const before: string = snapshot(s);
    const result: CliResult = publishCli(s);
    expectRefused(s, result, before, 'K-03');
    expect(existsSync(join(s.repo, SKILL))).toBe(false);
  });
});

describe('republish', () => {
  it('refuses a version other than the stamped one', () => {
    const s: Setup = published();
    const before: string = snapshot(s);
    const result: CliResult = cli(s.repo, ['publish', '--library', s.lib, '--version', '2.0.5', '--republish'], { GM_GH: s.gh.gh });
    expectRefused(s, result, before, 'only accepts the stamped version 2.0.4');
  });

  it('refuses when nothing is stamped', () => {
    const s: Setup = setup();
    expectRefused(s, publishCli(s, '--republish'), snapshot(s), 'publish normally first');
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

describe('compareVersions', () => {
  it('compares numerically per part', () => {
    expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.0', '2.0.99')).toBeGreaterThan(0);
    expect(compareVersions('2.0.4', '2.0.4')).toBe(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
  });
});
