import { describe, expect, it } from 'vitest';
import { withheldProblems } from '../../pipeline/withheld.ts';

describe('withheld phrases', () => {
  it('finds the withheld phrases across a line break, a non-breaking space or a hyphen', () => {
    const text: string = [
      'Some Known',
      'limitations here.',
      '',
      'Then release signing, and later release-signing again, and KNOWN   LIMITATIONS.',
      '',
    ].join('\n');
    const problems = withheldProblems('page.md', text);
    expect(problems.map((problem) => problem.check)).toEqual(['K-09', 'K-09', 'K-09', 'K-09']);
    expect(problems.every((problem) => problem.file === 'page.md')).toBe(true);
    expect(problems.map((problem) => problem.line).sort()).toEqual([1, 4, 4, 4]);
  });

  it('does not flag unknown limitations or two words split by a blank line', () => {
    expect(withheldProblems('page.md', 'unknown limitations\n\nknown\n\nlimitations\n\nrelease\n\nsigning\n')).toEqual([]);
  });

  it('does not flag a release or a signing alone', () => {
    expect(withheldProblems('page.md', 'The release is ready. Signing is not covered.')).toEqual([]);
  });
});
