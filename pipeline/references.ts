import { posix } from 'node:path';
import { headingSlugs, linkTargets, urlSpans } from './markdown.ts';
import type { UrlSpan } from './markdown.ts';
import { CheckError, LIBRARY_REPOSITORY, SKILL_DIR } from './model.ts';
import type { Problem } from './model.ts';
import type { DocsSource } from './source.ts';

const CHECK: string = 'K-06';
const INDEX: string = 'README.md';
const LIBRARY_URL: string = `https://github.com/${LIBRARY_REPOSITORY}`;
const LATEST_LLMS_TXT: string = 'https://graphmaquina.dev/v/latest/llms.txt';
const REFERENCES_DIR: string = `${SKILL_DIR}/references`;
const ABSOLUTE: RegExp = /^([a-z][a-z0-9+.-]*:|\/)/i;
const PAGE: RegExp = /^[^/]+\.md$/;

/** The path of a URL without its `?query` and `#fragment`, and those two suffixes as written. */
function splitUrl(url: string): { path: string; suffix: string } {
  const cut: number = url.search(/[?#]/);
  return cut === -1 ? { path: url, suffix: '' } : { path: url.slice(0, cut), suffix: url.slice(cut) };
}

function header(source: DocsSource): string {
  const from: string = source.ref.kind === 'branch' ? `branch ${source.ref.name}` : `tag v${source.version}`;
  return `> GraphMaquina ${source.version} documentation, copied from ${from} of ${LIBRARY_URL}. Other versions: ${LATEST_LLMS_TXT}`;
}

/** The names of the pages the index links: a Markdown file next to the index. */
function linkedPages(index: string): string[] {
  const names: Set<string> = new Set();
  for (const target of linkTargets(index)) {
    const { path } = splitUrl(target.url);
    if (PAGE.test(path) && path !== INDEX && !ABSOLUTE.test(path)) {
      names.add(path);
    }
  }
  return [...names];
}

/**
 * Pins one URL: a link to a copied page stays relative, one to anything else in the repository points to the same path
 * at the release on GitHub. A URL that cannot be resolved is left as it is, for `referenceProblems` to report.
 */
function pinned(url: string, source: DocsSource, linked: Set<string>): string {
  if (url === '' || url.startsWith('#') || ABSOLUTE.test(url)) {
    return url;
  }
  const { path, suffix } = splitUrl(url);
  if (path === '') {
    return url;
  }
  const repositoryPath: string = posix.normalize(posix.join('docs', path));
  if (repositoryPath.startsWith('..')) {
    return url;
  }
  const inDocs: string | undefined = repositoryPath.startsWith('docs/') ? repositoryPath.slice('docs/'.length) : undefined;
  if (inDocs !== undefined && PAGE.test(inDocs) && (linked.has(inDocs) || !source.files.has(inDocs))) {
    return url;
  }
  return `${LIBRARY_URL}/blob/${source.gitRef}/${repositoryPath}${suffix}`;
}

function rewritten(text: string, source: DocsSource, linked: Set<string>): string {
  let result: string = text;
  const spans: UrlSpan[] = urlSpans(text);
  for (let index: number = spans.length - 1; index >= 0; index--) {
    const span: UrlSpan | undefined = spans[index];
    if (span !== undefined) {
      result = result.slice(0, span.start) + pinned(span.url, source, linked) + result.slice(span.end);
    }
  }
  return result;
}

/**
 * The skill's `references/`: the docs index and every page it links, keyed by file name. Each text starts with a
 * header that names the version and where the docs were copied from; links to the rest of the repository point to
 * the same path at the release on GitHub, so nothing leaves the copied folder unresolved. Throws `CheckError`
 * (K-06) when the source has no index.
 */
export function buildReferences(source: DocsSource): Map<string, string> {
  const index: string | undefined = source.files.get(INDEX);
  if (index === undefined) {
    throw new CheckError([{ check: CHECK, file: 'docs', message: `the docs have no ${INDEX}` }]);
  }
  const names: string[] = linkedPages(index);
  const linked: Set<string> = new Set([INDEX, ...names]);
  const references: Map<string, string> = new Map();
  for (const name of [INDEX, ...names]) {
    const text: string | undefined = source.files.get(name);
    if (text !== undefined) {
      references.set(name, `${header(source)}\n\n${rewritten(text, source, linked)}`);
    }
  }
  return references;
}

/** The K-06 problems of generated references: links that leave the folder unresolved, to a missing page or anchor. */
export function referenceProblems(references: Map<string, string>): Problem[] {
  const problems: Problem[] = [];
  const slugs: Map<string, Set<string>> = new Map();
  const slugsOf = (name: string): Set<string> => {
    let found: Set<string> | undefined = slugs.get(name);
    if (found === undefined) {
      found = headingSlugs(references.get(name) ?? '');
      slugs.set(name, found);
    }
    return found;
  };
  for (const [name, text] of references) {
    const report = (line: number, message: string): void => {
      problems.push({ check: CHECK, file: `${REFERENCES_DIR}/${name}`, line, message });
    };
    for (const target of linkTargets(text)) {
      if (target.url === '' || ABSOLUTE.test(target.url)) {
        continue;
      }
      const { path, suffix } = splitUrl(target.url);
      const page: string = path === '' ? name : path;
      if (!PAGE.test(page)) {
        const how: string = path.startsWith('../') ? 'a leftover ../ link, not pinned to the release' : 'not a reference page';
        report(target.line, `link "${target.url}" is ${how}`);
      } else if (!references.has(page)) {
        const who: string = name === INDEX ? 'the index links' : 'the page links';
        report(target.line, `${who} ${page}, which is missing from the references`);
      } else if (suffix.startsWith('#') && suffix.length > 1) {
        let anchor: string = suffix.slice(1);
        try {
          anchor = decodeURIComponent(anchor);
        } catch {
          // an anchor that is not valid percent-encoding is compared as written
        }
        if (!slugsOf(page).has(anchor)) {
          report(target.line, `link "${target.url}" names the anchor "#${anchor}", which no heading of ${page} has`);
        }
      }
    }
  }
  return problems;
}
