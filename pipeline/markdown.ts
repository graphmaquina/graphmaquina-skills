import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

/** A URL written in a Markdown source: where its text starts and ends, the text itself and the line it is on. */
export type UrlSpan = { start: number; end: number; url: string; line: number };

const parser = unified().use(remarkParse).use(remarkGfm);
type Root = ReturnType<typeof parser.parse>;

/** The syntax tree of a Markdown source, parsed with the same grammar (CommonMark and GFM) as the link and heading readers. */
export function parseMarkdown(markdown: string): Root {
  return parser.parse(markdown);
}
const HTML_URL: RegExp = /(?<![\w-])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const WHITESPACE: RegExp = /\s/;

/** Finds the `]` that closes a link label whose `[` ends just before `from`. */
function labelEnd(markdown: string, from: number): number {
  let depth: number = 1;
  for (let index: number = from; index < markdown.length; index++) {
    const char: string | undefined = markdown[index];
    if (char === '\\') {
      index++;
    } else if (char === '[') {
      depth++;
    } else if (char === ']' && --depth === 0) {
      return index;
    }
  }
  return -1;
}

/** Reads the destination that starts at `from` (after the whitespace in front of it); undefined when there is none. */
function destinationAt(markdown: string, from: number): { start: number; end: number } | undefined {
  let start: number = from;
  while (start < markdown.length && WHITESPACE.test(markdown[start] ?? '')) {
    start++;
  }
  if (markdown[start] === '<') {
    for (let index: number = start + 1; index < markdown.length; index++) {
      const char: string | undefined = markdown[index];
      if (char === '\\') {
        index++;
      } else if (char === '>') {
        return index === start + 1 ? undefined : { start: start + 1, end: index };
      } else if (char === '\n' || char === '<') {
        return undefined;
      }
    }
    return undefined;
  }
  let depth: number = 0;
  let end: number = start;
  while (end < markdown.length) {
    const char: string = markdown[end] ?? '';
    if (char === '\\') {
      end += 2;
      continue;
    }
    if (WHITESPACE.test(char) || (char === ')' && depth === 0)) {
      break;
    }
    depth += char === '(' ? 1 : char === ')' ? -1 : 0;
    end++;
  }
  return end === start ? undefined : { start, end };
}

function lineAt(nodeLine: number, markdown: string, nodeStart: number, offset: number): number {
  let line: number = nodeLine;
  for (let index: number = nodeStart; index < offset; index++) {
    if (markdown[index] === '\n') {
      line++;
    }
  }
  return line;
}

/**
 * Every URL a Markdown source links, in document order: the destination of a link, an image and a reference
 * definition, and the `src` and `href` attributes of inline or block HTML. Text in code spans and code blocks is no
 * link. Autolinks and bare URLs are not listed, because no relative path can be one.
 */
export function urlSpans(markdown: string): UrlSpan[] {
  const tree: Root = parser.parse(markdown);
  const spans: UrlSpan[] = [];
  visit(tree, (node) => {
    const position = node.position;
    if (position === undefined) {
      return;
    }
    const nodeStart: number = position.start.offset ?? 0;
    const nodeEnd: number = position.end.offset ?? 0;
    if (node.type === 'html') {
      const text: string = markdown.slice(nodeStart, nodeEnd);
      if (text.startsWith('<!--')) {
        return;
      }
      for (const match of text.matchAll(HTML_URL)) {
        const value: string = match[1] ?? match[2] ?? '';
        const start: number = nodeStart + match.index + match[0].length - 1 - value.length;
        spans.push({ start, end: start + value.length, url: value, line: lineAt(position.start.line, markdown, nodeStart, start) });
      }
      return;
    }
    let close: number;
    let opener: string;
    if (node.type === 'link') {
      const last = node.children[node.children.length - 1];
      close = last?.position?.end.offset ?? labelEnd(markdown, nodeStart + 1);
      opener = '](';
    } else if (node.type === 'image') {
      close = labelEnd(markdown, nodeStart + 2);
      opener = '](';
    } else if (node.type === 'definition') {
      close = labelEnd(markdown, nodeStart + 1);
      opener = ']:';
    } else {
      return;
    }
    if (close < 0 || close >= nodeEnd || markdown.slice(close, close + 2) !== opener) {
      return;
    }
    const destination = destinationAt(markdown, close + 2);
    if (destination === undefined || destination.end > nodeEnd) {
      return;
    }
    spans.push({
      ...destination,
      url: markdown.slice(destination.start, destination.end),
      line: lineAt(position.start.line, markdown, nodeStart, destination.start),
    });
  });
  return spans.sort((a: UrlSpan, b: UrlSpan) => a.start - b.start);
}

/** Every URL a Markdown source links with the line it is on, as written. */
export function linkTargets(markdown: string): { url: string; line: number }[] {
  return urlSpans(markdown).map((span: UrlSpan) => ({ url: span.url, line: span.line }));
}

/**
 * The anchors GitHub gives the headings of a Markdown source. One slugger serves the whole source, so a repeated
 * heading gets `-1`, `-2`, and inline HTML tags take no part in the text, as in the site's pipeline.
 */
export function headingSlugs(markdown: string): Set<string> {
  const slugger: GithubSlugger = new GithubSlugger();
  const slugs: Set<string> = new Set();
  visit(parser.parse(markdown), 'heading', (node) => {
    slugs.add(slugger.slug(toString(node, { includeHtml: false })));
  });
  return slugs;
}
