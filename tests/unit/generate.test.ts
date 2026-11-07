import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSkill, generatedProblems, writeSkill } from '../../pipeline/generate.ts';
import type { Problem } from '../../pipeline/model.ts';
import { readWorktreeDocs } from '../../pipeline/source.ts';
import { cleanUp, library, temporary, VERSION } from '../helpers/repo.ts';

const TEMPLATE: string = '---\nname: graphmaquina\ndescription: d\ncompatibility: c {{version}}\nmetadata:\n  version: "{{version}}"\n---\n\nSee [g](references/guide.md#overview).\n';

afterEach(cleanUp);

describe('generateSkill', () => {
  it('stamps SKILL.md and prefixes the copied pages with references/', () => {
    const files: Map<string, string> = generateSkill(readWorktreeDocs(library(), VERSION), TEMPLATE);
    expect([...files.keys()].sort()).toEqual([
      'SKILL.md',
      'references/README.md',
      'references/diagnostics.md',
      'references/guide.md',
    ]);
    expect(files.get('SKILL.md')).toContain('version: "2.0.4"');
    expect(files.get('references/guide.md')).toContain('Use StateGraph here.');
  });
});

describe('generatedProblems', () => {
  it('gives a clean skill no problem and finds a missing page, K-03', () => {
    const files: Map<string, string> = generateSkill(readWorktreeDocs(library(), VERSION), TEMPLATE);
    expect(generatedProblems(files, VERSION)).toEqual([]);
    files.delete('references/guide.md');
    expect(generatedProblems(files, VERSION).map((problem: Problem): string => problem.check)).toContain('K-03');
  });
});

describe('writeSkill', () => {
  it('replaces the contents of the folder', () => {
    const dir: string = join(temporary('write'), 'skill');
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(join(dir, 'stale.md'), 'old');
    writeSkill(dir, new Map([['SKILL.md', 'one'], ['references/a.md', 'two']]));
    expect(existsSync(join(dir, 'stale.md'))).toBe(false);
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('one');
    expect(readFileSync(join(dir, 'references/a.md'), 'utf8')).toBe('two');
  });
});
