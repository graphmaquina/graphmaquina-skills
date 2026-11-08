# GraphMaquina skill

An [Agent Skill](https://agentskills.io) for [GraphMaquina](https://github.com/graphmaquina/graphmaquina), the Java 21
library for typed, graph-based state machines. Installed in your coding agent, it helps the agent create, change,
migrate, debug and test GraphMaquina machines in your Java project. The skill is one folder:

- `SKILL.md`: the instructions. The agent checks which GraphMaquina version your project uses, follows a set of ground
  rules, and works through a procedure for each task: a new machine, a change to an existing one, a migration from
  another library or a hand-written machine, a failing build, and the machine's tests.
- `references/`: the GraphMaquina documentation of that release, one page per file, copied from the library's release
  tag, or from its `docs/v<version>` branch when that branch holds documentation fixes of the release. The agent reads
  the documented API there instead of exploring the GraphMaquina jars.

Its description asks the agent to use it in Java projects that depend on `io.github.graphmaquina`, or when you ask to
migrate a state machine to GraphMaquina.

## Install

Replace `<version>` with the GraphMaquina version your project uses.

### Claude Code

```text
/plugin marketplace add graphmaquina/skills
/plugin install graphmaquina@graphmaquina
```

`/plugin install` opens the plugin's details, where you choose the install scope. This installs the skill of the
latest GraphMaquina release, from `main`. To pin the skill of one release, add its tag to the first command:
`/plugin marketplace add graphmaquina/skills#v<version>`.

To update the skill, use one of these:

- in `/plugin`, open `graphmaquina` on the **Installed** tab and choose **Update now**;
- in your shell, run `claude plugin update graphmaquina@graphmaquina`;
- in `/plugin`, select the `graphmaquina` marketplace on the **Marketplaces** tab and choose **Update marketplace**,
  which refreshes its listing and updates the plugins installed from it;
- on that same tab, choose **Enable auto-update** for the marketplace. Claude Code leaves auto-update off for
  third-party marketplaces.

The [Claude Code plugin documentation](https://code.claude.com/docs/en/plugins/install#keep-plugins-updated)
describes each route.

### Other agents

Copy the folder `plugins/graphmaquina/skills/graphmaquina/` of the tag `v<version>` into your project's skills folder.
From the project root, this line puts it in `.agents/skills/graphmaquina/`, replacing an older copy:

```bash
SKILLS=.agents/skills; git clone --depth 1 --branch v<version> https://github.com/graphmaquina/skills .graphmaquina-skills && rm -rf "$SKILLS/graphmaquina" && mkdir -p "$SKILLS" && cp -R .graphmaquina-skills/plugins/graphmaquina/skills/graphmaquina "$SKILLS/"; rm -rf .graphmaquina-skills
```

Set `SKILLS=.claude/skills` instead for `.claude/skills/graphmaquina/`. Pick the folder your agent reads:

| Folder | Read by, according to each agent's skills documentation |
| --- | --- |
| `.agents/skills/graphmaquina/` | [Codex](https://learn.chatgpt.com/docs/build-skills), [Cursor](https://cursor.com/docs/context/skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/), [GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) |
| `.claude/skills/graphmaquina/` | [Claude Code](https://code.claude.com/docs/en/skills), [Cursor](https://cursor.com/docs/context/skills), [GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) |

### claude.ai

Download `graphmaquina-skill-<version>.zip` from the
[GitHub release](https://github.com/graphmaquina/skills/releases) of `v<version>`, and add it to claude.ai as
Anthropic's article [How to create custom skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)
describes. The zip already holds the skill folder, `graphmaquina/`, at its root, the layout that article asks for.

## Tested agents

Tested with Claude Code. Codex, Cursor, Gemini CLI and GitHub Copilot read skills from the folders above according to
their own documentation, linked in the table; this skill has not been tested with them. It has not been tested on
claude.ai either: uploading the zip there has not been tried, and the zip is only known to hold the skill folder at
its root, as Anthropic's article describes.

## Versions

- Each GraphMaquina release from 2.0.4 on has its own skill, which documents exactly that version. The tag
  `v<version>` of this repository holds it, and tags never move.
- `main` holds the skill of the latest GraphMaquina release, never documentation of an unreleased version. It can
  still change for that same version: a documentation fix of the release, or improved instructions, regenerated for
  the version the skill already documents.
- The skill starts by checking your project's GraphMaquina version. For another version, it tells you, and until you
  install the matching skill it reads that version's documentation on graphmaquina.dev,
  `https://graphmaquina.dev/v/<version>/llms.txt`.

## Maintenance

| Path | What it holds |
| --- | --- |
| `template/SKILL.md` | The hand-written instructions; `{{version}}` marks where the generator writes the version. |
| `pipeline/` | The generator and the checks, in TypeScript run by Node. |
| `tests/` | The tests of the pipeline, run by vitest. |
| `plugins/graphmaquina/skills/graphmaquina/` | The generated skill: the stamped `SKILL.md` and `references/`. Never edit it by hand: change the template or the library's docs, and regenerate. `npm run check -- --library <dir>` fails when it differs from what the generator produces. |
| `.claude-plugin/marketplace.json`, `plugins/graphmaquina/.claude-plugin/plugin.json` | The Claude Code marketplace and plugin manifests. `plugin.json` has no `version`, so Claude Code installs follow `main`. |

The tooling needs Node 24.2 or later; run `npm ci` once. Publishing also needs `zip` and the GitHub CLI, `gh`. Every
command runs in this repository, and `--library` is a checkout of
[graphmaquina/graphmaquina](https://github.com/graphmaquina/graphmaquina):

| Command | What it does |
| --- | --- |
| `npm test` | Type-checks the pipeline and runs its tests. |
| `npm run generate -- --library <dir> --version <x.y.z> --out <dir> [--worktree]` | Generates the skill of a released version into `--out`, a folder that is neither this repository nor one that contains it. The docs come from the branch `docs/v<x.y.z>` when it exists, else from the tag `v<x.y.z>`; with `--worktree`, from the library's `docs/` as it is on disk. |
| `npm run check -- --library <dir>` | Checks that the committed skill is what the generator produces for the version it states, and runs every check on it. |
| `npm run release-gate -- --library <dir> --version <x.y.z>` | Generates the skill from the library's `docs/` as it is on disk, the commit about to be released, and runs every check. It writes nothing. Run it before a GraphMaquina release uploads anything. |
| `npm run publish -- --library <dir> --version <x.y.z>` | Once the release is tagged in the library: generates the skill from that release, commits it on `main`, tags `v<x.y.z>`, pushes both, and creates the GitHub release with the zip. It refuses a version older than the one on `main`, and a tag that already exists. |
| `npm run publish -- --library <dir> --version <x.y.z> --republish` | After a docs fix on the branch `docs/v<x.y.z>` of the version `main` already documents: regenerates the skill, commits and pushes `main`, and replaces the zip of that version's GitHub release. The tag does not move. |

## License

Apache License 2.0, like GraphMaquina. See [LICENSE](LICENSE).
