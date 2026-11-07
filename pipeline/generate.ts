import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { manifestProblems } from './manifests.ts';
import { CheckError } from './model.ts';
import type { Problem } from './model.ts';
import { buildReferences, referenceProblems } from './references.ts';
import { skillProblems, stampSkill } from './skill.ts';
import type { DocsSource } from './source.ts';
import { withheldProblems } from './withheld.ts';

/** The hand-written SKILL.md, relative to the repository root; `{{version}}` marks where the version goes. */
export const TEMPLATE_FILE: string = 'template/SKILL.md';
const SKILL_FILE: string = 'SKILL.md';
const REFERENCES_DIR: string = 'references';
const README_FILE: string = 'README.md';

/**
 * The generated skill for one docs source: `SKILL.md` (the template stamped with the version) and
 * `references/<page>.md` (the copied docs), keyed by their path inside the skill folder.
 */
export function generateSkill(source: DocsSource, template: string): Map<string, string> {
  const files: Map<string, string> = new Map([[SKILL_FILE, stampSkill(template, source.version)]]);
  for (const [name, text] of buildReferences(source)) {
    files.set(`${REFERENCES_DIR}/${name}`, text);
  }
  return files;
}

/** The problems of a generated skill: K-01 to K-05 and K-09 of its SKILL.md, K-06 of its references. */
export function generatedProblems(files: Map<string, string>, version: string): Problem[] {
  const references: Map<string, string> = new Map();
  for (const [path, text] of files) {
    if (path.startsWith(`${REFERENCES_DIR}/`)) {
      references.set(path.slice(REFERENCES_DIR.length + 1), text);
    }
  }
  return [...skillProblems(files.get(SKILL_FILE) ?? '', version, references), ...referenceProblems(references)];
}

/** Replaces everything in `dir` with `files`, whose keys are paths relative to `dir`. */
export function writeSkill(dir: string, files: Map<string, string>): void {
  rmSync(dir, { recursive: true, force: true });
  for (const [path, text] of files) {
    const target: string = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
}

/** Reads the template of the repository at `repo`; throws `CheckError` when it does not exist. */
export function readTemplate(repo: string): string {
  const path: string = join(repo, TEMPLATE_FILE);
  if (!existsSync(path)) {
    throw new CheckError([{ check: 'K-01', file: TEMPLATE_FILE, message: 'the template does not exist' }]);
  }
  return readFileSync(path, 'utf8');
}

/** The problems of the repository itself: K-07 manifests and K-09 withheld phrases in its README.md. */
export function repositoryProblems(repo: string): Problem[] {
  const readme: string = join(repo, README_FILE);
  return [
    ...manifestProblems(repo),
    ...(existsSync(readme) ? withheldProblems(README_FILE, readFileSync(readme, 'utf8')) : []),
  ];
}
