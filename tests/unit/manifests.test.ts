import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { manifestProblems } from '../../pipeline/manifests.ts';
import type { Problem } from '../../pipeline/model.ts';

const REPO_ROOT: string = resolve(import.meta.dirname, '../..');
const MARKETPLACE: string = '.claude-plugin/marketplace.json';
const PLUGIN: string = 'plugins/graphmaquina/.claude-plugin/plugin.json';
const NOREPLY: string = '60438622+0xhug0@users.noreply.github.com';

const fixtures: string[] = [];

/** Copies the two real manifests into a temporary repository root and applies `edit` to their parsed JSON. */
function fixture(edit: (marketplace: any, plugin: any) => void): string {
  const root: string = mkdtempSync(join(tmpdir(), 'gm-skills-manifests-'));
  fixtures.push(root);
  cpSync(join(REPO_ROOT, '.claude-plugin'), join(root, '.claude-plugin'), { recursive: true });
  cpSync(join(REPO_ROOT, 'plugins/graphmaquina/.claude-plugin'), join(root, 'plugins/graphmaquina/.claude-plugin'), {
    recursive: true,
  });
  const marketplace: any = JSON.parse(readFileSync(join(root, MARKETPLACE), 'utf8'));
  const plugin: any = JSON.parse(readFileSync(join(root, PLUGIN), 'utf8'));
  edit(marketplace, plugin);
  writeFileSync(join(root, MARKETPLACE), JSON.stringify(marketplace, null, 2));
  writeFileSync(join(root, PLUGIN), JSON.stringify(plugin, null, 2));
  return root;
}

function checks(problems: Problem[]): string[] {
  return problems.map((problem: Problem): string => problem.check);
}

afterEach((): void => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('manifestProblems', () => {
  it('the repository manifests pass', () => {
    expect(manifestProblems(REPO_ROOT)).toEqual([]);
  });

  it('an unmodified fixture passes', () => {
    expect(manifestProblems(fixture(() => {}))).toEqual([]);
  });

  it('a plugin.json with a version is reported', () => {
    const problems: Problem[] = manifestProblems(
      fixture((_marketplace: any, plugin: any): void => {
        plugin.version = '2.0.4';
      }),
    );
    expect(checks(problems)).toEqual(['K-07']);
    expect(problems[0]?.message).toContain('version');
  });

  it('an entry whose name differs from plugin.json is reported', () => {
    const problems: Problem[] = manifestProblems(
      fixture((marketplace: any): void => {
        marketplace.plugins[0].name = 'other';
      }),
    );
    expect(checks(problems)).toEqual(['K-07']);
    expect(problems[0]?.message).toContain('other');
  });

  it.each(['plugins/graphmaquina', '../escape', './plugins/../graphmaquina'])(
    'a source that does not start with ./ or contains .. is reported: %s',
    (source: string) => {
      const problems: Problem[] = manifestProblems(
        fixture((marketplace: any): void => {
          marketplace.plugins[0].source = source;
        }),
      );
      expect(checks(problems)).toContain('K-07');
      expect(problems.every((problem: Problem): boolean => problem.check === 'K-07')).toBe(true);
    },
  );

  it('an email other than the noreply is reported', () => {
    const problems: Problem[] = manifestProblems(
      fixture((_marketplace: any, plugin: any): void => {
        plugin.author.email = 'someone@example.com';
      }),
    );
    expect(checks(problems)).toEqual(['K-07']);
    expect(problems[0]?.message).toContain('someone@example.com');
  });

  it('the noreply email is accepted', () => {
    const problems: Problem[] = manifestProblems(
      fixture((marketplace: any): void => {
        marketplace.owner.email = NOREPLY;
      }),
    );
    expect(problems).toEqual([]);
  });

  it('a missing marketplace.json is reported', () => {
    const root: string = fixture(() => {});
    rmSync(join(root, MARKETPLACE));
    expect(checks(manifestProblems(root))).toEqual(['K-07']);
  });

  it('a marketplace without owner.name or plugins is reported', () => {
    const problems: Problem[] = manifestProblems(
      fixture((marketplace: any): void => {
        delete marketplace.owner;
        delete marketplace.plugins;
      }),
    );
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.every((problem: Problem): boolean => problem.check === 'K-07')).toBe(true);
  });
});
