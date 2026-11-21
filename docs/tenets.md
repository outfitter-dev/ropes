# Ropes Design Tenets

> Conventions you can run: one plan, every verdict explained.

These tenets are Ropes' slow-moving product doctrine. They guide how teams author conventions, understand findings, adopt changes, and learn from repairs. Principles state the beliefs that guide design; promises state the guarantees implementations must uphold. Neither is a feature inventory. Specifications distinguish accepted contracts from experiments, and technical documentation records what has shipped.

When implementation and a tenet disagree, fix the implementation or make an explicit decision to change the tenet. Do not reconcile the conflict only in tactical documentation.

## Documentation Layers

- **Tenets** explain what we believe and why. They change when our model of the product changes.
- **Specifications and decisions** define accepted behaviour and record tradeoffs. The [specification and decision register](https://linear.app/outfitter/document/fit-product-specification-and-decision-register-232485133059) governs current behaviour; the [product direction](https://linear.app/outfitter/document/ropes-product-direction-cli-design-and-repository-architecture-def8de43517b) describes its intended evolution.
- **Technical documentation** describes supported commands, contracts, configuration, and engine behaviour. [README.md](../README.md) is the entry point for what works today.
- **Contributor guidance** in [AGENTS.md](../AGENTS.md) describes how to work in this repository.

Product and package names, command syntax, schema fields, engine choices, and delivery milestones belong in the faster-moving layers.

## Terms

- A **convention** describes what good work looks like, with its reason, scope, and examples.
- A **check** evaluates selected work against rules or setup requirements.
- A **rule** expresses a specific requirement that a check evaluates. A convention may require several rules across several engines.
- A **preset** shares a coherent set of tool settings or policy for a repository to adopt.
- The **plan** resolves which policy and operations apply to the selected work, including checks and permitted repairs, with their sources and scope.
- A **finding** reports a specific problem, identifying the rule and check responsible and the affected work.

## Principles

### One plan, every verb

Policy resolution produces one inspectable plan. Explanation, checking, content repair, and setup maintenance use that plan within their own write limits. The resolver takes explicit inputs and runs no engines. Local tools, CI, and programmatic consumers should agree when given the same facts and scope.

Trace decisions to their sources and planned engine invocations, including why work was excluded and where a maintainer can change the policy. A missing engine limits confirmation; it should not hide the policy that selected it.

### A convention keeps its reasons

A recurring review comment should be able to become a tested convention that the next contributor discovers without finding the person who remembers it. Keep its reason, scope, checks, and examples together so the check remains explainable and its advice can be tested.

A convention may need several operations across several tools. Group them by the promise they uphold, keeping each operation identifiable. A finding should connect the precise check to the convention that explains it.

### State each fact once

Each authored policy fact should have one owner. Rule metadata should feed diagnostics, examples, inspection, and enforceable agent guidance. Shared settings should feed generated tool configuration. Derived files remain reproducible artifacts with an obvious source to edit.

Configs a person wrote remain valid. When shared facts disagree, report both sources. Ropes cannot know which author was right, so it does not silently choose.

### Preserve intent and respect the engine

Ropes composes existing quality tools. Authors should be able to express a convention without depending on an incidental engine choice wherever its meaning can be preserved. Adapters translate that intent into native rules and configuration, reporting the engine's capabilities and limitations.

Keep explicit native authoring when a shared concept cannot preserve meaning. Use the tool's own configuration and suppression conventions where they fit. Shared authoring requires evidence of faithful behaviour; it must not imply enforcement an engine cannot provide. Changing engines requires evidence that the convention still holds.

### The repository owns its policy

A repository decides its policy, exceptions, tool pins, and enforcement choices. With no config, documented defaults may apply, and the plan names them as defaults. Any change to active policy, whether through configuration or a version upgrade, must be reviewable. Discovery may suggest additional policy, but must not silently activate it beyond those defaults and explicit choices.

A finding can disappear because the code was repaired, a rule was disabled, an exception was added, or the file left the checked scope. Preserve those distinctions. A legitimate exception should be explicit and explainable.

### Adoption should fit ordinary development

Teams should be able to introduce a convention through small, reviewable changes while continuing to work. Preview its effect against known source, tools, and evaluation inputs before adoption.

Existing debt may be acknowledged for a defined scope if it stays visible, new or reintroduced violations cannot hide behind it, and allowances retire as repairs land. A lower count alone does not prove progress. Completion requires evidence for the whole promised scope.

### Help the next action

Use plain language and progressive disclosure in documentation, help, and findings. Start with the affected work, what needs to change, whether a fix is available, and the next step. Make the reason and full trace available when needed.

Humans and agents consume the same contract. Compact feedback may group or shorten findings, but must disclose omitted detail and preserve the complete structured result. Anything that changes the verdict belongs in the first answer.

### Fast feedback is part of the product

Feedback should arrive soon enough to shape the next edit. Seek improvements in engines and execution, and measure them on real repositories. Speed must come from doing required work efficiently, never from quietly reducing coverage or reusing evidence whose inputs no longer match.

### Every repair can teach the next contributor

Preserve what makes a repair useful: what failed, what was tried, what changed, what was checked, and which policy applied. Failed attempts can explain why the final edit was necessary.

An authored example is a recommendation. An observed repair is a prior from a particular context. An isolated replay can verify a repair under the tested policy and scope; it does not prove universal correctness. Keep those evidence levels distinct, including later reversions. A model's suggestion is not verification.

## Promises

### A pass means the required work completed

Required work that could not complete is incomplete, never clean. Blocking findings fail a completed run; advisory findings remain visible without failing it. Incomplete work takes precedence over blocking findings. A partial run never speaks for the whole repository. Report scope and omissions so the verdict cannot conceal missing work.

### Unknown contracts are errors

A config, plan, or result whose version Ropes does not recognise is rejected. An unsupported contract must never be interpreted as an empty policy or a successful result.

### Every write has a declared owner

Checking and explanation leave repository content and staged changes untouched. Content repair and setup repair have separate responsibilities. Generated files point back to authored input. A content fix never clears a finding by weakening the rule or rewriting the setup that found it.

### A fix settles

A preview must faithfully represent the proposed change and disclose any limit on what it can show. A second successful fix on unchanged input makes no further change. When writers undo each other, report the conflict instead of looping.

### Useful evidence does not require a hosted service

Local checking retains its verdict when a history service or upload is unavailable. When repair history is captured, keep it outside the working tree with durable links to the work and checks that produced it. Capture and sharing have explicit boundaries, and retrieval respects access to the source it reveals.

### Ropes stands on its own

A repository using ordinary tools and CI gets the convention workflow without adopting other Outfitter tools. Generated native configs remain usable by their engines without Ropes installed. Ropes reports quality evidence; the surrounding workflow owns execution authority, aggregate verification, merge decisions, and release qualification.

## Decision Patterns

### Start with a real convention and contrasting examples

Take a recurring review comment, write a case that should fail and a nearby case that should pass, then run the candidate across real source before enforcing it. Surprising matches refine scope and explanation. Examples should test the advice the convention gives.

### Choose the smallest useful contribution

Prefer a rule or setting when an engine already supports the behaviour. Use a preset to share coherent policy. Add an adapter when a new engine is needed. Add an abstraction or package when a demonstrated consumer or distribution need earns it.

### Compare like with like

To claim that a policy change alters coverage or an edit repairs a finding, hold other consequential inputs steady or name the differences. Distinguish configuration inference, engine confirmation, and observed results. Re-evaluate evidence when its context changes.

### Turn repeated friction into better conventions

Repeated exceptions, confusing findings, failed repairs, and competing fixes are evidence about the convention. Improve its scope, reason, examples, or implementation. Review a useful prior before promoting it into a maintained example.

## Applying the Tenets

A proposal fits when it uses the shared plan, keeps conventions explainable, reduces repeated authoring, preserves engine meaning, respects repository policy, and helps the next contributor act on trustworthy evidence. Specifications settle exact behaviour and identify experiments; technical docs describe what is available.
