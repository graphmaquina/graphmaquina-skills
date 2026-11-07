import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Problem } from './model.ts';

const CHECK: string = 'K-07';
const MARKETPLACE: string = '.claude-plugin/marketplace.json';
const PLUGIN_MANIFEST: string = '.claude-plugin/plugin.json';
const NOREPLY: string = '60438622+0xhug0@users.noreply.github.com';
const EMAIL: RegExp = /[^\s"'<>@]+@[^\s"'<>@]+\.[^\s"'<>@]+/g;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Reads a JSON object, or reports why it cannot. */
function readJson(root: string, file: string, problems: Problem[]): { text: string; json: Json } | undefined {
  const path: string = join(root, file);
  if (!existsSync(path)) {
    problems.push({ check: CHECK, file, message: 'the file does not exist' });
    return undefined;
  }
  const text: string = readFileSync(path, 'utf8');
  try {
    const json: unknown = JSON.parse(text);
    if (isObject(json)) return { text, json };
    problems.push({ check: CHECK, file, message: 'the file is not a JSON object' });
  } catch (error: unknown) {
    problems.push({ check: CHECK, file, message: `the file is not valid JSON: ${(error as Error).message}` });
  }
  return undefined;
}

/** Reports every email in the text except the GitHub noreply address. */
function emailProblems(file: string, text: string, problems: Problem[]): void {
  for (const email of new Set(text.match(EMAIL) ?? [])) {
    if (email !== NOREPLY) problems.push({ check: CHECK, file, message: `the manifest carries the email ${email}` });
  }
}

/** The reason a relative plugin source is invalid, or `undefined` when it is valid. */
function sourceProblem(source: string): string | undefined {
  if (!source.startsWith('./')) return `the source ${source} does not start with ./`;
  if (source.split('/').includes('..')) return `the source ${source} contains ..`;
  return undefined;
}

/** K-07: the Claude Code marketplace and plugin manifests are valid and carry no version and no personal email. */
export function manifestProblems(repoRoot: string): Problem[] {
  const problems: Problem[] = [];
  const marketplace: { text: string; json: Json } | undefined = readJson(repoRoot, MARKETPLACE, problems);
  if (marketplace === undefined) return problems;
  emailProblems(MARKETPLACE, marketplace.text, problems);

  const { json } = marketplace;
  if (!isNonEmptyString(json.name)) problems.push({ check: CHECK, file: MARKETPLACE, message: 'name is missing' });
  if (!isObject(json.owner) || !isNonEmptyString(json.owner.name)) {
    problems.push({ check: CHECK, file: MARKETPLACE, message: 'owner.name is missing' });
  }
  if (!Array.isArray(json.plugins) || json.plugins.length === 0) {
    problems.push({ check: CHECK, file: MARKETPLACE, message: 'plugins is missing or empty' });
    return problems;
  }

  for (const entry of json.plugins as unknown[]) {
    if (!isObject(entry) || !isNonEmptyString(entry.name) || !isNonEmptyString(entry.source)) {
      problems.push({ check: CHECK, file: MARKETPLACE, message: 'a plugin entry lacks name or source' });
      continue;
    }
    const reason: string | undefined = sourceProblem(entry.source);
    if (reason !== undefined) {
      problems.push({ check: CHECK, file: MARKETPLACE, message: reason });
      continue;
    }
    const manifestFile: string = `${entry.source.slice(2)}/${PLUGIN_MANIFEST}`;
    const plugin: { text: string; json: Json } | undefined = readJson(repoRoot, manifestFile, problems);
    if (plugin === undefined) continue;
    emailProblems(manifestFile, plugin.text, problems);
    if (plugin.json.name !== entry.name) {
      problems.push({
        check: CHECK,
        file: manifestFile,
        message: `the marketplace entry name ${entry.name} differs from the plugin.json name ${String(plugin.json.name)}`,
      });
    }
    if ('version' in plugin.json) {
      problems.push({ check: CHECK, file: manifestFile, message: 'plugin.json must not carry a version' });
    }
  }
  return problems;
}
