import type { Problem } from './model.ts';

/*
 * The word rule is ported from graphmaquina-site/pipeline/withheld.ts (`phrase()` and its constants); only the
 * words part of the site's S-18 check applies here, not its page, heading and link logic.
 */

/** What may stand between the two words: spaces (non-breaking ones too) and hyphens, and at most one line break. */
const SEPARATOR: string = '(?:[^\\S\\r\\n]|-)';
const LINE_END: string = '(?:\\r\\n|\\n|\\r)';

/**
 * The phrase `first second` as a whole: `\b` on both sides, so "unknown limitations" is not "known limitations", and
 * between the words a run of spaces and hyphens, or one line break with its spaces. A blank line is not allowed: it
 * ends the paragraph, so the words are no longer one phrase.
 */
function phrase(first: string, second: string): RegExp {
  return new RegExp(`\\b${first}(?:${SEPARATOR}+|${SEPARATOR}*${LINE_END}${SEPARATOR}*)${second}\\b`, 'gi');
}

/** The phrases that no published text may hold. */
const WITHHELD_WORDS: RegExp[] = [phrase('known', 'limitations'), phrase('release', 'signing')];

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/**
 * The K-09 problems of a text: one for each place where "known limitations" or "release signing" stands, in any
 * case, also across a line break, a non-breaking space or a hyphen, as whole words and not across a blank line.
 *
 * @param file the name the problems report
 * @param text the text as written
 */
export function withheldProblems(file: string, text: string): Problem[] {
  return WITHHELD_WORDS.flatMap((words: RegExp): Problem[] =>
    [...text.matchAll(words)].map(
      (match: RegExpMatchArray): Problem => ({
        check: 'K-09',
        file,
        line: lineAt(text, match.index ?? 0),
        message: `withheld content: the words "${match[0].replace(/\s+/g, ' ')}"`,
      }),
    ),
  );
}
