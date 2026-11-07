import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, git, library, put, SKILL, skillsRepo, temporary, VERSION } from '../helpers/repo.ts';
import type { CliResult } from '../helpers/repo.ts';

afterEach(cleanUp);

/** A skills repository with the skill generated for 2.0.4 and committed. */
function stampedRepo(lib: string): string {
  const { repo } = skillsRepo();
  const result: CliResult = cli(repo, ['generate', '--library', lib, '--version', VERSION, '--out', join(repo, SKILL)]);
  expect(result.status).toBe(0);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'stamp');
  return repo;
}

describe('generate', () => {
  it('writes SKILL.md and references to --out', () => {
    const { repo } = skillsRepo();
    const out: string = join(temporary('out'), 'skill');
    const result: CliResult = cli(repo, ['generate', '--library', library(), '--version', VERSION, '--out', out, '--worktree']);
    expect(result.status).toBe(0);
    expect(readFileSync(join(out, 'SKILL.md'), 'utf8')).toContain('GraphMaquina 2.0.4');
    expect(readFileSync(join(out, 'references/README.md'), 'utf8')).toContain('# Docs');
    expect(readFileSync(join(out, 'references/guide.md'), 'utf8')).toContain('Use StateGraph here.');
  });

  it('reads the tag without --worktree', () => {
    const { repo } = skillsRepo();
    const lib: string = library();
    put(lib, 'docs/guide.md', '# Guide\n\n## Overview\n\nEdited after the tag.\n');
    const out: string = join(temporary('out'), 'skill');
    expect(cli(repo, ['generate', '--library', lib, '--version', VERSION, '--out', out]).status).toBe(0);
    expect(readFileSync(join(out, 'references/guide.md'), 'utf8')).toContain('Use StateGraph here.');
  });

  it('refuses an --out that is or contains the repository', () => {
    const { repo } = skillsRepo();
    const result: CliResult = cli(repo, ['generate', '--library', library(), '--version', VERSION, '--out', repo]);
    expect(result.status).toBe(2);
    expect(readFileSync(join(repo, 'template/SKILL.md'), 'utf8')).toContain('{{version}}');
  });
});

describe('usage', () => {
  it('exits 2 on an unknown command, a missing option and an unknown option', () => {
    const { repo } = skillsRepo();
    expect(cli(repo, ['nope']).status).toBe(2);
    expect(cli(repo, ['release-gate', '--version', VERSION]).status).toBe(2);
    expect(cli(repo, ['release-gate', '--library', 'x', '--version', VERSION, '--bogus']).status).toBe(2);
    expect(cli(repo, ['check', '--version', VERSION]).status).toBe(2);
  });
});

describe('release-gate', () => {
  it('exits 0 for a valid library and leaves the repository untouched', () => {
    const { repo } = skillsRepo();
    const result: CliResult = cli(repo, ['release-gate', '--library', library(), '--version', VERSION]);
    expect(result.status).toBe(0);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('exits 1 and names K-03 when the template links a missing page', () => {
    const { repo } = skillsRepo();
    const template: string = readFileSync(join(repo, 'template/SKILL.md'), 'utf8');
    put(repo, 'template/SKILL.md', template.replace('references/guide.md#overview', 'references/missing.md'));
    const result: CliResult = cli(repo, ['release-gate', '--library', library(), '--version', VERSION]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/K-03 SKILL\.md:\d+ /);
  });

  it('exits 1 and names K-09 when the README holds a withheld phrase', () => {
    const { repo } = skillsRepo();
    put(repo, 'README.md', '# Skills\n\nSee the known limitations.\n');
    const result: CliResult = cli(repo, ['release-gate', '--library', library(), '--version', VERSION]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/K-09 README\.md:3 /);
  });

  it('exits 1 and names K-07 when a manifest carries a version', () => {
    const { repo } = skillsRepo();
    put(repo, 'plugins/graphmaquina/.claude-plugin/plugin.json', '{"name":"graphmaquina","version":"1.0.0"}');
    const result: CliResult = cli(repo, ['release-gate', '--library', library(), '--version', VERSION]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('K-07');
  });

  it('exits 1 when the template does not exist', () => {
    const { repo } = skillsRepo();
    git(repo, 'rm', '-q', 'template/SKILL.md');
    const result: CliResult = cli(repo, ['release-gate', '--library', library(), '--version', VERSION]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('template/SKILL.md');
  });
});

describe('check', () => {
  it('passes and says so when nothing is published yet', () => {
    const { repo } = skillsRepo();
    const result: CliResult = cli(repo, ['check']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('no skill has been published yet');
  });

  it('passes for a skill that matches the generator and needs --library', () => {
    const lib: string = library();
    const repo: string = stampedRepo(lib);
    expect(cli(repo, ['check', '--library', lib]).status).toBe(0);
    expect(cli(repo, ['check']).status).toBe(2);
  });

  it('fails with K-08 when the template changed without regenerating', () => {
    const lib: string = library();
    const repo: string = stampedRepo(lib);
    const template: string = readFileSync(join(repo, 'template/SKILL.md'), 'utf8');
    put(repo, 'template/SKILL.md', `${template}\nA new paragraph.\n`);
    const result: CliResult = cli(repo, ['check', '--library', lib]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('K-08 SKILL.md');
  });

  it('reports added and missing files with K-08', () => {
    const lib: string = library();
    const repo: string = stampedRepo(lib);
    put(repo, `${SKILL}/references/extra.md`, 'extra');
    git(repo, 'rm', '-q', `${SKILL}/references/guide.md`);
    const result: CliResult = cli(repo, ['check', '--library', lib]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('K-08 references/extra.md');
    expect(result.stderr).toContain('K-08 references/guide.md');
  });

  it('applies K-09 to the README when nothing is published yet', () => {
    const { repo } = skillsRepo();
    put(repo, 'README.md', 'Release signing is described elsewhere.\n');
    const result: CliResult = cli(repo, ['check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('K-09 README.md:1');
  });
});
