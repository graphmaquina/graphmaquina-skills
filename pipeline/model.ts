/** One reason the repository cannot be published, reported by the check that found it. */
export type Problem = { check: string; file: string; line?: number; message: string };

/** Thrown when a check finds problems; carries all of them so the caller can print each one. */
export class CheckError extends Error {
  readonly problems: Problem[];

  constructor(problems: Problem[]) {
    super(`${problems.length} problem(s) found`);
    this.name = 'CheckError';
    this.problems = problems;
  }
}

/** The directory, relative to the repository root, that holds the generated Agent Skill. */
export const SKILL_DIR: string = 'plugins/graphmaquina/skills/graphmaquina';

/** The GitHub repository that publishes the skill. */
export const SKILLS_REPOSITORY: string = 'graphmaquina/skills';

/** The GitHub repository of the library whose docs the skill copies. */
export const LIBRARY_REPOSITORY: string = 'graphmaquina/graphmaquina';
