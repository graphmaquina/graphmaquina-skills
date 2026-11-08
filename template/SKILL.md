---
name: graphmaquina
description: Create, change, migrate, debug and test GraphMaquina state machines. Use in Java projects that depend on io.github.graphmaquina, or to migrate a state machine to GraphMaquina.
license: Apache-2.0
compatibility: Java 21+ projects that use GraphMaquina {{version}} with Gradle or Maven
metadata:
  version: "{{version}}"
  documentation: "https://graphmaquina.dev/v/{{version}}/"
---

# GraphMaquina

This skill documents GraphMaquina {{version}}. GraphMaquina builds typed, graph-based state machines for Java 21: you
declare identified edges with annotations, the build generates a typed API and validates the whole graph, and an
in-process runtime runs each call against the entity you pass.

The folder `references/` holds the GraphMaquina {{version}} documentation, one page per file, and
[references/README.md](references/README.md) is its index. Read only the page and section a step needs.

Follow the developer's project conventions: code style, `var` or explicit types, Lombok, test framework. The examples
in the references show the shape of the API, not a style to impose.

## 1. Check the version first

Before anything else, read the GraphMaquina version the project uses, from the first of these that exists:

- the Gradle property `graphmaquinaVersion`, usually in `gradle.properties`;
- the Maven property `graphmaquina.version` in `pom.xml`;
- a version catalog entry, such as one in `gradle/libs.versions.toml`;
- the version of the `io.github.graphmaquina` plugin, or of the `io.github.graphmaquina:graphmaquina-core` coordinates.

Compare it with {{version}} and act:

- The same version: use the references for everything.
- Another 2.0.x, 2.0.1 or later: tell the developer that this skill documents {{version}}, and suggest installing the
  skill of their version, tag `v<version>` of `github.com/graphmaquina/graphmaquina-skills`, when that tag exists. Meanwhile, for
  anything that depends on the API, read `https://graphmaquina.dev/v/<version>/llms.txt` and the pages it lists
  instead of the references.
- 1.x, or a version whose `https://graphmaquina.dev/v/<version>/llms.txt` does not answer: tell the developer that this
  skill does not cover it, and do not guess its API.
- No GraphMaquina in the project: go on only when the developer asked for a new GraphMaquina machine or a migration to
  GraphMaquina, and configure {{version}} as section 4 says.

## 2. Do not explore the jars

Learn the API from the references only. They document the public API of GraphMaquina {{version}}: annotations,
generated names, method signatures, outcomes, every `SG` diagnostic, the runtime exceptions and the test assertions.

Look in this order:

1. The "Find a feature" table of [references/README.md](references/README.md#find-a-feature), which maps a task to its
   page and section, and the tables above it, which describe every page.
2. The page's own contents list and reference tables, such as the
   [annotation and binding reference](references/graph-model.md#annotation-and-binding-reference), the
   [diagnostics](references/diagnostics.md), the [runtime exceptions](references/runtime-exceptions.md) and the
   [testing entry points](references/testing.md#what-each-entry-point-checks).
3. A text search of the references folder for the identifier.
4. After a build, the project's own generated sources, which show the exact generated names: their folders are in
   [generated files](references/generation.md#generated-files).

Never unzip, decompile or list the GraphMaquina jars, and never search the Maven or Gradle caches for them. If
something still seems missing, tell the developer what you looked for and where, and ask how to go on. For another
version, read that version's llms.txt, as section 1 says.

## 3. Ground rules

Each rule links the section that backs it. Read that section when the rule applies.

- Write two enums by hand, one of states and one of transition identifiers. GraphMaquina derives no identifier from an
  action name, a method name or a destination.
  [TicketTransition.java](references/quickstart.md#tickettransitionjava)
- The generator writes the vocabulary before javac runs, and the processor writes the runtime classes during
  compilation; for the quickstart, `TicketsGraph`, `TicketRefs` and `TicketActionsRefs`, then `TicketsRuntime` and
  `TicketMachinesRuntime`. Refer to them in source before they exist, and never create placeholder, empty or copied
  versions of them. Before the first build, an editor or language server may flag them as missing: that is expected,
  and the build resolves them. [Tickets.java](references/quickstart.md#ticketsjava),
  [write the complete flow immediately](references/generation.md#you-can-also-write-the-complete-flow-immediately),
  [IDE workflow](references/generation.md#ide-workflow), [generated names](references/graph-model.md#generated-names)
- Initialize the entity's state field when the entity is created: `initial` describes the graph and initializes no
  entity, and a null state aborts the call. The runtime calls the state setter at commit; action code never calls it.
  [Ticket.java](references/quickstart.md#ticketjava),
  [initialize and protect state](references/commit-and-persistence.md#initialize-and-protect-state)
- An edge is keyed by its origin and its identifier. Two declarations of one key are `SG102`, even with different
  guards: there is no first-guard-wins. Give each branch its own identifier, or route through an intermediate state
  whose automatic edges are tried in order. [Understand the graph](references/graph-model.md#understand-the-graph),
  [choice and junction](references/migrate-from-another-library.md#choice-and-junction-pseudo-states)
- List the final states in `terminals`: a terminal has no outgoing edge at all, a self-loop included (`SG202`). For
  every cycle, self-loops included, list one of its states in `allowsCycle`, which takes no state outside a cycle.
  Every state is reachable from `initial`, and every state that is not terminal has an outgoing edge.
  [Structural rules](references/graph-model.md#structural-rules)
- Give every state that is not terminal a `StatePolicy` with its `otherwise` reason (`SG701`), and word the refusal of
  one identifier with `Reject`. An edge and a `Reject` for the same key are `SG702`.
  [Policies](references/graph-model.md#policies-every-node-answers)
- An action that can return `ActionOutcome.failed(...)` needs a route: a recovery rule for its failure kind, or an
  `onFailure` edge from the same origin. Without one, the call throws `UnhandledFailureException` and commits nothing.
  [Domain failures](references/actions-and-failures.md#domain-failures)
- A refused request (`Rejected`) and a routed failure (`Failed`) come back to the caller as an `Outcome`, not as an
  exception: the caller reads `status()` or `code()`. Inside a cascade, a refusal aborts the whole call instead.
  [Handle transition outcomes](references/outcomes.md#handle-transition-outcomes),
  [cascade a transition](references/coordination.md#cascade-a-transition)
- An action moves another machine with `ctx.cascade(...)` or `ctx.cascadeAll(...)`, never by calling a facade on its
  own thread, which throws `ReentrantTransitionException`.
  [Cascade a transition](references/coordination.md#cascade-a-transition),
  [what to investigate](references/runtime-exceptions.md#what-to-investigate)
- An operation takes the entity and at most one input. Never pass null for either: a null input is refused with
  `NullPointerException` before the call starts. An event without data is an operation without an input.
  [Actions, guards and failure routes](references/actions-and-failures.md#actions-guards-and-failure-routes),
  [events with data](references/migrate-from-another-library.md#events-with-data)
- Keep every GraphMaquina artifact of every module on the same version, however the build declares it: a generator,
  processor or producer of another version fails with `SG602`. The generator and the processor are build tools, never
  application runtime dependencies.
  [Requirements and artifacts](references/guide.md#requirements-and-artifacts)
- With Lombok, declare its annotation processor before GraphMaquina's.
  [Requirements and artifacts](references/guide.md#requirements-and-artifacts),
  [add Lombok](references/installation.md#add-lombok-when-you-need-it)
- Build through the configured Gradle or Maven lifecycle, which generates before javac. Plain `javac` or an IDE build
  that bypasses the adapter skips the generation, and the processor run without it fails with `SG602`; in Maven,
  `compiler:compile` alone skips it too.
  [IDE workflow](references/generation.md#ide-workflow),
  [Maven lifecycle](references/installation.md#maven-lifecycle-and-constraints)

## 4. New machine

1. If the project has no GraphMaquina yet, configure Gradle or Maven with version {{version}} as
   [install and configure the build](references/installation.md) shows.
2. Model the machine with the developer: the states, the initial one and the final ones; every edge as identifier,
   origin and destination; its guards, its action and its failure route; the reason each state gives for what it
   refuses; and the intended cycles. Ask when the domain is ambiguous instead of guessing.
3. Write the files in the shape of the [quickstart](references/quickstart.md): the two enums; the entity, with
   `@GraphProperty` on its state and its identity; a bindings class with `@GraphAction`, `@GraphGuard` and
   `@GraphHook` methods, whose signatures are in [method signatures](references/graph-model.md#method-signatures);
   the `@GenerateGraphApi` interface that extends `Machine` and carries the generated `Definition`, `StatePolicy`,
   `Reject` and `Transition` annotations; and the `@StateGraphs` set. This typed annotation path is the main
   workflow. Use the [programmatic DSL](references/dsl.md) only for a graph that must be assembled at runtime.
4. Build, and fix every diagnostic as section 7 says.
5. Write the tests of section 8.
6. Before writing code for anything more the domain needs, such as operation input, recovery rules, automatic
   transitions, asynchronous actions, sub-machines, machine sets and cascades, after-commit hooks or eligibility
   checks, find its page as section 9 says.

Done when the build passes with no `SG` diagnostic and the tests of section 8 pass.

## 5. Existing machine

1. Find the interfaces marked `@GenerateGraphApi`, the sets marked `@StateGraphs` and the classes whose methods carry
   `@GraphAction`, `@GraphGuard`, `@GraphHook` or another of the
   [handwritten markers](references/graph-model.md#handwritten-markers). A graph built in code starts with
   `StateGraph.define`.
2. Understand the graph from its declarations. To see it whole, read its `definition()` or export it, as
   [inspect graphs and export diagrams](references/graph-inspection.md) shows.
3. Make the change and rebuild: renamed declarations regenerate their symbols, and javac names the handwritten
   references to fix ([IDE workflow](references/generation.md#ide-workflow)). Before adding a feature the machine does
   not use yet, such as a recovery rule or an automatic edge, find its page as section 9 says. Keep the build and the
   tests green, and test what changed as section 8 says, following
   [testing-advanced.md](references/testing-advanced.md) for recovery rules, automatic edges and sub-machines.
4. When the project has goldens or structural snapshots, regenerate them on purpose, as
   [reading and updating](references/testing.md#reading-and-updating) shows, review the diff, and tell the developer
   what changed in the graph.

## 6. Migration

Translate the original machine with [migrate a machine from another library](references/migrate-from-another-library.md),
following [its procedure](references/migrate-from-another-library.md#the-procedure):

1. Inventory the original machine: its states, the initial and the final ones; its events and their payloads; every
   transition as source, event, guard, target and action; where its state lives and how its machine instances are
   created, started and stored; every concept of the guide it uses, found under its general name in the guide's
   contents; and every hierarchical, nested or composite state, each one a sub-machine candidate.
2. Before writing any code, read the guide's procedure and the whole entry of every concept in the inventory: open and
   read each one, never only a text search of the guide.
3. Composite states, when the inventory lists any. Before writing any code, read
   [declare a sub-machine](references/composition.md#declare-a-sub-machine) and
   [sub-machines over the same entity](references/composition.md#sub-machines-over-the-same-entity), then bind each
   composite state to a sub-machine as [composite states](references/migrate-from-another-library.md#composite-states)
   says. A parallel state with several regions is not one sub-machine, since a state holds at most one (`SG803`):
   translate it with the parallel regions pattern of step 4. Flatten a composite state only when your report says you
   flattened it and why a sub-machine does not fit. GraphMaquina nests machines: never tell the developer that nested
   states are missing or impossible.
4. Translate every other concept with its entry. For a concept without a direct equivalent, such as entry and exit
   actions, choice states, [history states](references/migration-patterns.md#history-states) (inside a sub-machine:
   [restore a sub-machine](references/migration-patterns.md#restore-a-sub-machine)),
   [parallel regions](references/migration-patterns.md#parallel-regions), timers or deferred events, use the closest
   pattern its entry gives. [Migration patterns](references/migration-patterns.md) builds and tests each of them
   except choice states.
5. Warn, from a checklist. Before the report, list each sentence of the "What changes" and the notes of every concept
   the original uses, whatever its kind, those translated with a migration pattern included, and mark each one relayed
   or not applicable. Relay each applicable sentence in the report as a warning of its own, in your words, naming the
   concept, never folded into the description of a pattern. Two are dropped most often: the stored history field is
   the developer's to persist with the entity, and an event goes to one region's facade, never to all regions. When the
   original lets exceptions out of an action, relay that an exception the edge does not declare now aborts the call,
   commits nothing and reaches the caller wrapped in a `TransitionAbortedException`
   ([errors in actions](references/migrate-from-another-library.md#errors-in-actions)). For a concept without a direct
   equivalent, also say which alternative you used.
6. Write the parity test that step 4 of the procedure describes, with `graphmaquina-test`: the structure of the new
   graph, and every path of the original replayed through the facade.
7. Keep the original machine until the developer asks you to remove it.
8. End your report with the full list of warnings.

## 7. When the build or a call fails

- Read the whole message, with the source location and the member it names.
- An SG code: find its row in [diagnostics](references/diagnostics.md) and fix the declaration it names.
- A build failure without a code: [build troubleshooting](references/build-troubleshooting.md#troubleshooting) and
  [common build problems](references/diagnostics.md#common-build-problems).
- An exception at runtime: [what to investigate](references/runtime-exceptions.md#what-to-investigate). A `Rejected` or
  `Failed` outcome is returned, not thrown, except that a refusal inside a cascade aborts the whole call:
  [handle transition outcomes](references/outcomes.md#handle-transition-outcomes).
- Fix the cause, and keep every check in place: keep `-Werror`, keep the processor enabled, keep the failing test, and
  leave the generated files to the build. Change the processor configuration or a lint option only as the references
  prescribe, such as declaring Lombok's processor first
  ([add Lombok](references/installation.md#add-lombok-when-you-need-it)), adding `testAnnotationProcessor` for graphs
  declared under the test sources, or `-Xlint:-processing` for a test compilation that runs the processor
  ([source sets](references/installation.md#source-sets-and-generator-selection)).

## 8. Tests

- Add `graphmaquina-test` as a test dependency, at the project's GraphMaquina version
  ([install](references/testing.md#install)). The static import `GraphAssertions.assertThat` is the entry point for
  outcomes, definitions and entities.
- Build the set in the test as the application does, with real entities and test doubles only for what lies outside
  the process ([your first test](references/testing.md#your-first-test)). Tests that only call the generated main
  facades normally need no `testAnnotationProcessor`
  ([source sets](references/installation.md#source-sets-and-generator-selection)).
- Cover:
  - every edge applied: `isApplied()`, `movedTo` and the live state with `hasEntityState`;
  - every guard rejection: `isRejectedByGuardNamed`;
  - every failure route: `isFailed()`, `hasFailureTransition` and `movedTo`;
  - every policy answer of a state that is not terminal: `hasNoTransition()` and `hasReason` with the policy's exact
    reason, both, or `rejects(id, reason)` on the definition's policy;
  - at least one structure test: typed assertions on `definition()`, such as `hasInitial`, `hasTerminalsExactly` and
    `hasTransitionsExactly`, or `GraphSnapshots.assertMatches`, as
    [what each entry point checks](references/testing.md#what-each-entry-point-checks) and
    [goldens and structural snapshots](references/testing.md#goldens-and-structural-snapshots) show;
  - every automatic edge, including those a migration pattern adds: `automaticSteps()` and the entity's final state,
    and `automaticBlock()` where the references say an arrival reports a block.
- Test recovery rules, automatic edges and sub-machines as
  [failure kinds and recovery rules](references/testing-advanced.md#failure-kinds-and-recovery-rules),
  [automatic transitions](references/testing-advanced.md#automatic-transitions) and
  [sub-machines](references/testing-advanced.md#sub-machines) show.
- Before relying on an assertion, read [what a check does not prove](references/testing.md#what-a-check-does-not-prove).
- More samples: [graphs, outcomes, probes and async](references/testing-samples.md), and
  [the call's flow and its trail](references/testing-advanced.md#the-calls-flow-and-its-trail).

## 9. Find a feature

[references/README.md](references/README.md#find-a-feature) is the router. Its "Find a feature" table maps a task, such
as passing a value from the caller to guards and actions or running a whole machine inside one state, to the page and
section that covers it. Read that section before writing code for the feature.

## 10. Report back

Tell the developer:

- what you changed, file by file, in exact words: "added" for what you added, such as compiler flags, and "kept" only
  for what was already there;
- the ambiguities of the domain you resolved, and how you resolved each;
- the build and test commands you ran and their results, with the number of tests run and failed;
- the choices you made on the developer's behalf and what each changes, such as keeping a wrapper or facade over the
  generated runtime: a refusal runs no hook, so a trail of refusals needs a `MachineObserver` or that wrapper;
- for a migration, each composite state of the original and the sub-machine it became, or why you flattened it, or
  that the original has none; and the full list of warnings;
- any version mismatch from section 1, and anything you looked for in the references and did not find.
