import { describe, expect, it } from 'vitest';
import type { Problem } from '../../pipeline/model.ts';
import { skillProblems, stampSkill, stampedVersion } from '../../pipeline/skill.ts';

const VERSION: string = '2.0.4';

const FRONTMATTER: string = [
  '---',
  'name: graphmaquina',
  'description: Build state machines with GraphMaquina.',
  'compatibility: GraphMaquina {{version}}, Java 21.',
  'metadata:',
  '  version: "{{version}}"',
  '---',
].join('\n');

const TEMPLATE: string = [
  FRONTMATTER,
  '',
  '# GraphMaquina {{version}}',
  '',
  'Read [the guide](references/guide.md#overview) and the [site](https://graphmaquina.dev).',
  'Call `StateGraph` and see SG101. Ignore `a/b`, `two words`, `<T>` and `page.md`.',
  '',
].join('\n');

const REFERENCES: Map<string, string> = new Map([
  ['README.md', '# Docs\n'],
  ['guide.md', '# Guide\n\n## Overview\n\nUse StateGraph here.\n'],
  ['diagnostics.md', '# Diagnostics\n\n| SG101 | text |\n'],
]);

function skill(edit: (text: string) => string = (text: string): string => text): string {
  return edit(stampSkill(TEMPLATE, VERSION));
}

function problemsOf(text: string, references: Map<string, string> = REFERENCES): Problem[] {
  return skillProblems(text, VERSION, references);
}

function checks(text: string, references?: Map<string, string>): string[] {
  return problemsOf(text, references).map((problem: Problem): string => problem.check);
}

describe('stampSkill', () => {
  it('replaces every placeholder', () => {
    const stamped: string = stampSkill(TEMPLATE, VERSION);
    expect(stamped).not.toContain('{{');
    expect(stamped).toContain('GraphMaquina 2.0.4, Java 21.');
    expect(stamped).toContain('# GraphMaquina 2.0.4');
  });

  it('throws on a template without the placeholder', () => {
    expect(() => stampSkill('no placeholder', VERSION)).toThrow();
  });

  it('gives a clean skill no problem', () => {
    expect(problemsOf(skill())).toEqual([]);
  });
});

describe('stampedVersion', () => {
  it('reads metadata.version', () => {
    expect(stampedVersion(skill())).toBe('2.0.4');
  });

  it('is undefined without frontmatter', () => {
    expect(stampedVersion('# Title\n')).toBeUndefined();
  });
});

describe('K-01 frontmatter', () => {
  it('rejects a frontmatter key outside name, description, license, compatibility, metadata, allowed-tools', () => {
    const problems: Problem[] = problemsOf(skill((text: string): string => text.replace('---\n\n', 'version: 1\n---\n\n')));
    expect(problems.map((problem: Problem): string => problem.check)).toEqual(['K-01']);
    expect(problems[0]?.message).toContain('"version"');
    expect(problems[0]?.file).toBe('SKILL.md');
  });

  it('accepts license and allowed-tools', () => {
    const text: string = skill((t: string): string => t.replace('---\n\n', 'license: MIT\nallowed-tools: Read\n---\n\n'));
    expect(problemsOf(text)).toEqual([]);
  });

  it('rejects a name other than graphmaquina', () => {
    const problems: Problem[] = problemsOf(skill((text: string): string => text.replace('name: graphmaquina', 'name: other')));
    expect(problems.map((problem: Problem): string => problem.message)).toEqual(['the name must be "graphmaquina"']);
  });

  it('rejects a description over 200 characters', () => {
    const long: string = 'x'.repeat(201);
    expect(checks(skill((text: string): string => text.replace('Build state machines with GraphMaquina.', long)))).toEqual(['K-01']);
    const exact: string = 'x'.repeat(200);
    expect(checks(skill((text: string): string => text.replace('Build state machines with GraphMaquina.', exact)))).toEqual([]);
  });

  it('rejects a compatibility over 500 characters', () => {
    const long: string = 'x'.repeat(501);
    expect(checks(skill((text: string): string => text.replace('GraphMaquina 2.0.4, Java 21.', long)))).toEqual(['K-01']);
  });

  it('rejects a metadata.version other than the stamped version', () => {
    const problems: Problem[] = problemsOf(skill((text: string): string => text.replace('version: "2.0.4"', 'version: "2.0.3"')));
    expect(problems.map((problem: Problem): string => problem.check)).toEqual(['K-01']);
    expect(problems[0]?.message).toContain('2.0.4');
  });

  it('rejects a missing frontmatter', () => {
    expect(checks('# Title\n')).toEqual(['K-01']);
  });
});

describe('K-02 size', () => {
  it('rejects 500 lines or more', () => {
    const padding = (lines: number): string => skill((text: string): string => text + 'line\n'.repeat(lines - text.split('\n').length + 1));
    expect(checks(padding(499))).toEqual([]);
    expect(checks(padding(500))).toEqual(['K-02']);
  });

  it('rejects more than 20480 bytes', () => {
    const base: number = Buffer.byteLength(skill(), 'utf8');
    const fill = (bytes: number): string => skill((text: string): string => text + 'a'.repeat(bytes - base - 1) + '\n');
    expect(checks(fill(20480))).toEqual([]);
    expect(checks(fill(20481))).toEqual(['K-02']);
  });

  it('rejects a fenced code block in the body', () => {
    const problems: Problem[] = problemsOf(skill((text: string): string => `${text}\n\`\`\`java\nint x;\n\`\`\`\n`));
    expect(problems.map((problem: Problem): string => problem.check)).toEqual(['K-02']);
    expect(problems[0]?.line).toBe(14);
  });

  it('rejects a tilde fence but not an indented block', () => {
    expect(checks(skill((text: string): string => `${text}\n~~~\nx\n~~~\n`))).toEqual(['K-02']);
    expect(checks(skill((text: string): string => `${text}\n    indented\n`))).toEqual([]);
  });
});

describe('K-03 links', () => {
  it('rejects a references link to a missing page or anchor', () => {
    const page: Problem[] = problemsOf(skill((text: string): string => `${text}\nSee [x](references/missing.md).\n`));
    expect(page.map((problem: Problem): string => problem.check)).toEqual(['K-03']);
    const anchor: Problem[] = problemsOf(skill((text: string): string => `${text}\nSee [x](references/guide.md#nope).\n`));
    expect(anchor.map((problem: Problem): string => problem.check)).toEqual(['K-03']);
    expect(anchor[0]?.line).toBe(14);
  });

  it('rejects a relative link outside references/', () => {
    for (const url of ['other.md', '../README.md', '#overview', 'references/images/x.svg', 'http://example.com']) {
      expect(checks(skill((text: string): string => `${text}\nSee [x](${url}).\n`))).toEqual(['K-03']);
    }
  });

  it('accepts https links', () => {
    expect(checks(skill((text: string): string => `${text}\nSee [x](https://example.com/a/b.md#c).\n`))).toEqual([]);
  });
});

describe('K-04 identifiers', () => {
  it('rejects a backticked span missing from the references', () => {
    const problems: Problem[] = problemsOf(skill((text: string): string => `${text}\nUse \`Missing\`.\n`));
    expect(problems.map((problem: Problem): string => problem.check)).toEqual(['K-04']);
    expect(problems[0]?.line).toBe(14);
  });

  it('ignores spans with a slash, a space, a < or a .md ending', () => {
    const extra: string = '\n`x/y` `x y` `List<T>` `nothing.md`\n';
    expect(checks(skill((text: string): string => text + extra))).toEqual([]);
  });

  it('does not read fenced code as inline code', () => {
    expect(checks(skill((text: string): string => `${text}\n\`\`\`\n\`Missing\`\n\`\`\`\n`))).toEqual(['K-02']);
  });
});

describe('K-05 diagnostic codes', () => {
  it('rejects an SG code missing from references/diagnostics.md', () => {
    const problems: Problem[] = problemsOf(skill((text: string): string => `${text}\nSee SG999.\n`));
    expect(problems.map((problem: Problem): string => problem.check)).toEqual(['K-05']);
    expect(problems[0]?.line).toBe(14);
  });

  it('flags every code when diagnostics.md is missing', () => {
    const references: Map<string, string> = new Map(REFERENCES);
    references.delete('diagnostics.md');
    expect(checks(skill(), references)).toEqual(['K-05']);
  });
});

describe('K-09 withheld phrases', () => {
  it('finds the withheld phrases in the skill', () => {
    const problems: Problem[] = problemsOf(skill((text: string): string => `${text}\nSee the known\nlimitations.\n`));
    expect(problems.map((problem: Problem): string => problem.check)).toEqual(['K-09']);
    expect(problems[0]?.file).toBe('SKILL.md');
  });
});
