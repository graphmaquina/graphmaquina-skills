import { describe, expect, it } from 'vitest';
import { CheckError } from '../../pipeline/model.ts';
import type { Problem } from '../../pipeline/model.ts';
import { headingSlugs, linkTargets } from '../../pipeline/markdown.ts';
import { buildReferences, referenceProblems } from '../../pipeline/references.ts';
import { readWorktreeDocs } from '../../pipeline/source.ts';
import type { DocsRef, DocsSource } from '../../pipeline/source.ts';

const VERSION: string = '2.0.4';
const REPOSITORY: string = 'https://github.com/graphmaquina/graphmaquina';
const TAG_HEADER: string =
  `> GraphMaquina ${VERSION} documentation, copied from tag v${VERSION} of ${REPOSITORY}. ` +
  'Other versions: https://graphmaquina.dev/v/latest/llms.txt';
const BRANCH_HEADER: string = TAG_HEADER.replace(`tag v${VERSION}`, `branch docs/v${VERSION}`);

const INDEX: string = [
  '# GraphMaquina documentation',
  '',
  '| Page | What it covers |',
  '| --- | --- |',
  '| [Quickstart](quickstart.md) | A runnable machine |',
  '| [Guide](guide.md#overview) | The overview |',
  '| [Illustrations](images/README.md) | The pictures |',
  '',
].join('\n');

function source(files: Record<string, string>, ref: DocsRef = { kind: 'tag', tag: `v${VERSION}` }): DocsSource {
  const gitRef: string = ref.kind === 'branch' ? ref.name : `v${VERSION}`;
  return { version: VERSION, ref, gitRef, files: new Map(Object.entries(files)) };
}

function pages(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'README.md': INDEX,
    'quickstart.md': '# Quickstart\n\nBack to the [documentation index](README.md).\n',
    'guide.md': '# Guide\n\n## Overview\n\nText.\n',
    'images/README.md': '# Illustrations\n',
    'images/x.svg': '<svg/>',
    ...extra,
  };
}

function problemsOf(references: Map<string, string>): Problem[] {
  return referenceProblems(references);
}

describe('references', () => {
  it('copies the index and every page its tables link', () => {
    const references: Map<string, string> = buildReferences(source(pages({ 'unlinked.md': '# Unlinked\n' })));
    expect([...references.keys()].sort()).toEqual(['README.md', 'guide.md', 'quickstart.md']);
  });

  it('prepends the version header', () => {
    const body: string = pages()['quickstart.md'] ?? '';
    const tagged: string = buildReferences(source(pages())).get('quickstart.md') ?? '';
    expect(tagged).toBe(`${TAG_HEADER}\n\n${body}`);
    const worktree: string =
      buildReferences({ ...source(pages()), ref: { kind: 'worktree' } }).get('quickstart.md') ?? '';
    expect(worktree.split('\n')[0]).toBe(TAG_HEADER);
    const branch: string =
      buildReferences(
        source(pages(), { kind: 'branch', name: `docs/v${VERSION}`, tagCommit: 'abc' }),
      ).get('quickstart.md') ?? '';
    expect(branch.split('\n')[0]).toBe(BRANCH_HEADER);
    expect(branch.split('\n')[1]).toBe('');
  });

  it('rewrites ../ links to the GitHub ref and keeps the fragment', () => {
    const page: string = 'See [the test](../graphmaquina-example/src/A.java#L10) and [notice](../NOTICE?plain=1).\n';
    const out: string = buildReferences(source(pages({ 'quickstart.md': page }))).get('quickstart.md') ?? '';
    expect(out).toContain(`](${REPOSITORY}/blob/v${VERSION}/graphmaquina-example/src/A.java#L10)`);
    expect(out).toContain(`](${REPOSITORY}/blob/v${VERSION}/NOTICE?plain=1)`);
    expect(out.endsWith('.\n')).toBe(true);
  });

  it('rewrites ../ in reference definitions and inline HTML', () => {
    const page: string = [
      '# Q',
      '',
      'A [ref][a] and <a href="../b/B.java">b</a> and <img src="images/x.svg" alt="x">.',
      '',
      '[a]: ../a/A.java#L1 "Title"',
      '',
      '<p><img src=\'../c/c.png\'></p>',
      '',
    ].join('\n');
    const out: string = buildReferences(source(pages({ 'quickstart.md': page }))).get('quickstart.md') ?? '';
    const blob: string = `${REPOSITORY}/blob/v${VERSION}`;
    expect(out).toContain(`[a]: ${blob}/a/A.java#L1 "Title"`);
    expect(out).toContain(`<a href="${blob}/b/B.java">b</a>`);
    expect(out).toContain(`<img src="${blob}/docs/images/x.svg" alt="x">`);
    expect(out).toContain(`<img src='${blob}/c/c.png'>`);
  });

  it('rewrites images and images/README.md to docs/images on GitHub and keeps the alt text', () => {
    const page: string = '![Alt [text] here](images/x.svg) and [pictures](images/README.md#top).\n';
    const out: string = buildReferences(source(pages({ 'quickstart.md': page }))).get('quickstart.md') ?? '';
    const blob: string = `${REPOSITORY}/blob/v${VERSION}`;
    expect(out).toContain(`![Alt [text] here](${blob}/docs/images/x.svg)`);
    expect(out).toContain(`[pictures](${blob}/docs/images/README.md#top)`);
    const index: string = buildReferences(source(pages())).get('README.md') ?? '';
    expect(index).toContain(`[Illustrations](${blob}/docs/images/README.md)`);
  });

  it('uses the branch name in URLs for a branch source', () => {
    const page: string = '[a](../a/A.java) ![x](images/x.svg)\n';
    const out: string =
      buildReferences(
        source(pages({ 'quickstart.md': page }), { kind: 'branch', name: `docs/v${VERSION}`, tagCommit: 'abc' }),
      ).get('quickstart.md') ?? '';
    expect(out).toContain(`](${REPOSITORY}/blob/docs/v${VERSION}/a/A.java)`);
    expect(out).toContain(`](${REPOSITORY}/blob/docs/v${VERSION}/docs/images/x.svg)`);
  });

  it('keeps page-to-page links relative', () => {
    const page: string =
      'Next: [guide](guide.md#overview), [self](#quickstart), [web](https://example.com/a?b=c#d), [mail](mailto:a@b.c).\n';
    const out: string = buildReferences(source(pages({ 'quickstart.md': page }))).get('quickstart.md') ?? '';
    expect(out).toContain(page);
  });

  it('leaves links inside code blocks alone', () => {
    const page: string = [
      '```markdown',
      '[a](../a/A.java)',
      '<img src="images/x.svg">',
      '```',
      '',
      'Inline `[a](../a/A.java)` and [real](../r/R.java).',
      '',
      '    [indented](../i/I.java)',
      '',
    ].join('\n');
    const out: string = buildReferences(source(pages({ 'quickstart.md': page }))).get('quickstart.md') ?? '';
    expect(out).toContain('```markdown\n[a](../a/A.java)\n<img src="images/x.svg">\n```');
    expect(out).toContain('Inline `[a](../a/A.java)` and ');
    expect(out).toContain('    [indented](../i/I.java)');
    expect(out).toContain(`[real](${REPOSITORY}/blob/v${VERSION}/r/R.java)`);
  });

  it('keeps the text outside the links byte for byte, including angle destinations and non-ASCII', () => {
    const page: string = 'Ünï **b** [a *b*](<../a b/A.java> "t") \r\n  tail  \n';
    const out: string = buildReferences(source(pages({ 'quickstart.md': page }))).get('quickstart.md') ?? '';
    expect(out).toBe(`${TAG_HEADER}\n\nÜnï **b** [a *b*](<${REPOSITORY}/blob/v${VERSION}/a b/A.java> "t") \r\n  tail  \n`);
  });

  it('splices a link that wraps an image or inline HTML in document order', () => {
    const page: string = '[![alt](images/x.svg)](../graphmaquina-example/A.java)\n\n[<img src="images/y.svg">](../B.java)\n';
    const out: string = buildReferences(source(pages({ 'quickstart.md': page }))).get('quickstart.md') ?? '';
    const blob: string = `${REPOSITORY}/blob/v${VERSION}`;
    expect(out).toBe(
      `${TAG_HEADER}\n\n[![alt](${blob}/docs/images/x.svg)](${blob}/graphmaquina-example/A.java)\n\n` +
        `[<img src="${blob}/docs/images/y.svg">](${blob}/B.java)\n`,
    );
    expect(linkTargets(page).map((target: { url: string }) => target.url)).toEqual([
      'images/x.svg',
      '../graphmaquina-example/A.java',
      'images/y.svg',
      '../B.java',
    ]);
  });

  it('refuses a source without an index', () => {
    let problems: Problem[] = [];
    try {
      buildReferences(source({ 'quickstart.md': '# Q\n' }));
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(CheckError);
      problems = (error as CheckError).problems;
    }
    expect(problems).toHaveLength(1);
    expect(problems[0]?.check).toBe('K-06');
  });

  it('headingSlugs follows GitHub for backticks and repeated headings', () => {
    const slugs: Set<string> = headingSlugs(
      '# `@GraphGuard` and guards\n\n## Policies\n\n## Policies\n\n```\n# not a heading\n```\n',
    );
    expect(slugs).toContain('graphguard-and-guards');
    expect(slugs).toContain('policies');
    expect(slugs).toContain('policies-1');
    expect(slugs.size).toBe(3);
  });

  it('linkTargets lists links, images, definitions and html with their lines', () => {
    const targets: { url: string; line: number }[] = linkTargets(
      ['[a](a.md)', '', '![i](images/x.svg "t")', '', '[d]: ../d.java', '', '<a href="h.md">h</a>', '', '`[c](c.md)`'].join('\n'),
    );
    expect(targets).toEqual([
      { url: 'a.md', line: 1 },
      { url: 'images/x.svg', line: 3 },
      { url: '../d.java', line: 5 },
      { url: 'h.md', line: 7 },
    ]);
  });

  it('referenceProblems reports a leftover ../ link, a missing anchor and a page the index links but that is missing', () => {
    const references: Map<string, string> = new Map([
      ['README.md', '# Index\n\n[Quickstart](quickstart.md)\n\n[Gone](gone.md)\n'],
      ['quickstart.md', '# Quickstart\n\nSee [a](../a/A.java).\n\nAnd [b](README.md#nowhere).\n\n[ok](#quickstart) [ok](README.md#index)\n'],
    ]);
    const problems: Problem[] = problemsOf(references);
    expect(problems.map((problem: Problem) => problem.check)).toEqual(['K-06', 'K-06', 'K-06']);
    expect(problems.map((problem: Problem) => [problem.file.split('/').pop(), problem.line])).toEqual([
      ['README.md', 5],
      ['quickstart.md', 3],
      ['quickstart.md', 5],
    ]);
    expect(problems[0]?.message).toContain('gone.md');
    expect(problems[1]?.message).toContain('../a/A.java');
    expect(problems[2]?.message).toContain('nowhere');
  });

  it('referenceProblems passes the generated references', () => {
    expect(problemsOf(buildReferences(source(pages())))).toEqual([]);
  });

  const library: string | undefined = process.env['GM_LIBRARY'];
  it.skipIf(library === undefined)('the real docs pass', () => {
    const references: Map<string, string> = buildReferences(readWorktreeDocs(library ?? '', VERSION));
    expect(references.size).toBeGreaterThan(20);
    expect(problemsOf(references)).toEqual([]);
  });
});
