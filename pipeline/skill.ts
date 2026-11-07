import { parse } from 'yaml';
import { headingSlugs, linkTargets, parseMarkdown } from './markdown.ts';
import type { Problem } from './model.ts';
import { withheldProblems } from './withheld.ts';
import { visit } from 'unist-util-visit';

const SKILL_FILE: string = 'SKILL.md';
const PLACEHOLDER: string = '{{version}}';
const FRONTMATTER: RegExp = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const ALLOWED_KEYS: string[] = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
const SKILL_NAME: string = 'graphmaquina';
const MAX_DESCRIPTION: number = 200;
const MAX_COMPATIBILITY: number = 500;
/** The line count from which the skill is too long. */
const MAX_LINES: number = 500;
/** About 5 000 tokens at 4 characters per token: the criterion of `DocsRules.kt` (40 960 bytes, 10 000 tokens). */
const MAX_BYTES: number = 20480;
const REFERENCE_LINK: RegExp = /^references\/([^/#?]+\.md)(?:#(.*))?$/;
const DIAGNOSTICS_PAGE: string = 'diagnostics.md';
const DIAGNOSTIC_CODE: RegExp = /SG\d{3}/g;

type Frontmatter = { data: unknown; error?: string; lines: number; body: string };

/** The SKILL.md frontmatter, its parsed data and the body after it; `lines` is how many lines come before the body. */
function frontmatterOf(skill: string): Frontmatter | undefined {
  const match: RegExpExecArray | null = FRONTMATTER.exec(skill);
  if (match === null) {
    return undefined;
  }
  const lines: number = match[0].split('\n').length - 1;
  const body: string = skill.slice(match[0].length);
  try {
    return { data: parse(match[1] ?? ''), lines, body };
  } catch (error) {
    return { data: undefined, error: (error as Error).message, lines, body };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Replaces every `{{version}}` of the template with the version; a template without it is an error. */
export function stampSkill(template: string, version: string): string {
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`the SKILL.md template has no ${PLACEHOLDER} placeholder`);
  }
  return template.replaceAll(PLACEHOLDER, version);
}

/** The `metadata.version` the frontmatter of a SKILL.md states; undefined when there is none. */
export function stampedVersion(skill: string): string | undefined {
  const data: unknown = frontmatterOf(skill)?.data;
  const metadata: unknown = isRecord(data) ? data['metadata'] : undefined;
  const version: unknown = isRecord(metadata) ? metadata['version'] : undefined;
  return typeof version === 'string' ? version : undefined;
}

function problem(check: string, message: string, line?: number): Problem {
  return line === undefined ? { check, file: SKILL_FILE, message } : { check, file: SKILL_FILE, line, message };
}

/** K-01: the frontmatter holds only the fields the Agent Skills spec allows, with the skill's values and limits. */
function frontmatterProblems(front: Frontmatter | undefined, version: string): Problem[] {
  if (front === undefined) {
    return [problem('K-01', 'the SKILL.md has no frontmatter', 1)];
  }
  if (front.error !== undefined) {
    return [problem('K-01', `the frontmatter is not valid YAML: ${front.error}`, 1)];
  }
  const data: unknown = front.data;
  if (!isRecord(data)) {
    return [problem('K-01', 'the frontmatter is not a map of fields', 1)];
  }
  const problems: Problem[] = [];
  for (const key of Object.keys(data)) {
    if (!ALLOWED_KEYS.includes(key)) {
      problems.push(problem('K-01', `frontmatter key "${key}" is not one of ${ALLOWED_KEYS.join(', ')}`, 1));
    }
  }
  if (data['name'] !== SKILL_NAME) {
    problems.push(problem('K-01', `the name must be "${SKILL_NAME}"`, 1));
  }
  const description: unknown = data['description'];
  if (typeof description !== 'string' || description === '') {
    problems.push(problem('K-01', 'the description is missing', 1));
  } else if (description.length > MAX_DESCRIPTION) {
    problems.push(problem('K-01', `the description has ${description.length} characters, over ${MAX_DESCRIPTION}`, 1));
  }
  const compatibility: unknown = data['compatibility'];
  if (compatibility !== undefined && typeof compatibility !== 'string') {
    problems.push(problem('K-01', 'the compatibility must be a string', 1));
  } else if (typeof compatibility === 'string' && compatibility.length > MAX_COMPATIBILITY) {
    problems.push(problem('K-01', `the compatibility has ${compatibility.length} characters, over ${MAX_COMPATIBILITY}`, 1));
  }
  const metadata: unknown = data['metadata'];
  if (!isRecord(metadata)) {
    problems.push(problem('K-01', 'the metadata must be a map of strings', 1));
  } else {
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value !== 'string') {
        problems.push(problem('K-01', `metadata.${key} must be a string`, 1));
      }
    }
    if (metadata['version'] !== version) {
      problems.push(problem('K-01', `metadata.version must be "${version}"`, 1));
    }
  }
  return problems;
}

/** K-02: the skill stays short, and carries no code block of its own. */
function sizeProblems(skill: string, front: Frontmatter | undefined): Problem[] {
  const problems: Problem[] = [];
  const text: string = skill.endsWith('\n') ? skill.slice(0, -1) : skill;
  const lines: number = text.split('\n').length;
  if (lines >= MAX_LINES) {
    problems.push(problem('K-02', `the SKILL.md has ${lines} lines, ${MAX_LINES} or more`));
  }
  const bytes: number = Buffer.byteLength(skill, 'utf8');
  if (bytes > MAX_BYTES) {
    problems.push(problem('K-02', `the SKILL.md has ${bytes} bytes, over ${MAX_BYTES}`));
  }
  const offset: number = front?.lines ?? 0;
  const body: string = front?.body ?? skill;
  visit(parseMarkdown(body), 'code', (node) => {
    const start: number = node.position?.start.offset ?? 0;
    if (/^(?:```|~~~)/.test(body.slice(start))) {
      problems.push(problem('K-02', 'the body holds a fenced code block', offset + (node.position?.start.line ?? 1)));
    }
  });
  return problems;
}

/** K-03: every link points at an existing page of references/ and an existing heading of it, or is an https link. */
function linkProblems(front: Frontmatter | undefined, skill: string, references: Map<string, string>): Problem[] {
  const offset: number = front?.lines ?? 0;
  const problems: Problem[] = [];
  for (const { url, line } of linkTargets(front?.body ?? skill)) {
    const at: number = offset + line;
    if (url.startsWith('https://')) {
      continue;
    }
    const match: RegExpExecArray | null = REFERENCE_LINK.exec(url);
    if (match === null) {
      problems.push(problem('K-03', `the link "${url}" is neither https nor references/<page>.md`, at));
      continue;
    }
    const page: string | undefined = references.get(match[1] ?? '');
    if (page === undefined) {
      problems.push(problem('K-03', `the link "${url}" points at a page that is not in the references`, at));
    } else if (match[2] !== undefined) {
      let anchor: string = match[2];
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        // a malformed escape is looked up as written
      }
      if (!headingSlugs(page).has(anchor)) {
        problems.push(problem('K-03', `the link "${url}" points at a heading that is not in ${match[1]}`, at));
      }
    }
  }
  return problems;
}

/**
 * K-04: every backticked inline-code span, except those with a slash, a space or a `<` and those ending in `.md`,
 * appears literally in the references.
 */
function identifierProblems(front: Frontmatter | undefined, skill: string, references: Map<string, string>): Problem[] {
  const offset: number = front?.lines ?? 0;
  const text: string = [...references.values()].join('\n');
  const problems: Problem[] = [];
  visit(parseMarkdown(front?.body ?? skill), 'inlineCode', (node) => {
    const span: string = node.value;
    if (/[/ <]/.test(span) || span.endsWith('.md') || text.includes(span)) {
      return;
    }
    problems.push(problem('K-04', `the span \`${span}\` does not appear in the references`, offset + (node.position?.start.line ?? 1)));
  });
  return problems;
}

/** K-05: every SGnnn code of the skill is documented in references/diagnostics.md. */
function codeProblems(skill: string, references: Map<string, string>): Problem[] {
  const diagnostics: string = references.get(DIAGNOSTICS_PAGE) ?? '';
  return skill.split('\n').flatMap((text: string, index: number): Problem[] =>
    [...text.matchAll(DIAGNOSTIC_CODE)]
      .filter((match: RegExpMatchArray): boolean => !diagnostics.includes(match[0]))
      .map((match: RegExpMatchArray): Problem => problem('K-05', `${match[0]} is not in references/${DIAGNOSTICS_PAGE}`, index + 1)),
  );
}

/**
 * The problems of a stamped SKILL.md: K-01 frontmatter, K-02 size and code blocks, K-03 links, K-04 identifiers,
 * K-05 diagnostic codes and K-09 withheld phrases.
 *
 * @param skill the stamped SKILL.md
 * @param version the version it must state in `metadata.version`
 * @param references the copied docs, keyed `README.md` and `<page>.md`
 */
export function skillProblems(skill: string, version: string, references: Map<string, string>): Problem[] {
  const front: Frontmatter | undefined = frontmatterOf(skill);
  return [
    ...frontmatterProblems(front, version),
    ...sizeProblems(skill, front),
    ...linkProblems(front, skill, references),
    ...identifierProblems(front, skill, references),
    ...codeProblems(skill, references),
    ...withheldProblems(SKILL_FILE, skill),
  ];
}
