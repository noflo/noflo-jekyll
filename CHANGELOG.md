# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The nested `_posts` discovery: the scan subgraph joins every root entry with `/_posts` (`strings/Append`, whose standing suffix control keeps the value readable across the whole entry stream) and reads each discovered directory. The merged posts leg is wrapped by the new `jekyll/StreamEnvelope` relay, which terminates the per-listing framing and emits one outer bracket frame that closes when the leg reaches EOT — the stream-level collector flushes once over the complete collection instead of once per source group. This is the component-level form of the EOT-to-packet terminator convention (work documents #40 update #10 and #47 §8); the nested post's path-derived category rides the same wave (`jekyll/PathMetadata`'s `source` control is now fed and declared `scoped: false`).
- NoFlo 2.x reimplementation of the Jekyll static site generator on the `2.x` branch: plain ESM with zero build step, Node.js >= 22, components built on the `@noflo/assembly` message-relay conventions (assembly `Component` base class, `errors` array, `fail`/`failed` helpers) instead of the 1.x WirePattern queues.
- New component set: `jekyll/LoadDocument`, `jekyll/FrontMatter`, `jekyll/PathMetadata`, `jekyll/BuildPostPath`, `jekyll/PostCollector` (stateless collect-until-stream-close), `jekyll/ExpandPosts`, `jekyll/DocumentBuilder` (template inheritance and pagination), `jekyll/CopyStatic`, and the `jekyll/ScanSource` source-tree scan subgraph.
- Redesigned graph set: a single `Build` pipeline graph plus the `ScanSource` subgraph, generated with `scripts/generate-graphs.js` and committed for the package manifest. The 0.x eight-graph set is replaced by message-shaped relay wiring with transport-level brackets.
- `lib/Jekyll` embedding library on the 2.x network API (`asPromise` with a live `GraphModel`), the `bin/noflo-jekyll` CLI with an unchanged command-line contract (`noflo-jekyll source target`), and `scripts/generate-graphs.js`.
- Test suite on `node:test`: per-component units and an end-to-end fixture-site build test pinning the expected build outputs.
- Behavior parity is asserted against the 1.x fixtures, including the 1.x name-with-extension permalink quirk (`:title` keeping `.md`).

### Changed

- `jekyll/DocumentBuilder` waits in the port buffer again: documents are consumed head-first when the standing config and template store can resolve them, one partition per message scope, with the has-first rule peeking the head via a validator pinned to the first data IP. The per-scope state store the relay carried through the scopeless-re-fire era is obsolete under the one-firing rule — the engine re-fires every scope that holds pending documents on each arrival. The template corpus is standing site configuration: a control gate whose arrival re-fires the buffered documents, read as one bracket-framed stream (`jekyll/StreamEnvelope` merges the layouts and includes listings — the control buffer keeps the latest stream, so two separate listing groups would discard each other) and re-registered idempotently on every firing. The `config` port follows the gate model accordingly: control, standing, non-consuming.
- Dependencies moved to the `@noflo` namespace (`@noflo/noflo`, `@noflo/assembly`, `@noflo/assembly-utils`, `@noflo/core`, `@noflo/filesystem`, `@noflo/groups`, `@noflo/liquid`, `@noflo/markdown`), all on the 2.x line; site config parsing uses `yaml`.
- Platform dependencies moved to the released `2.0.0-alpha.10` set (`@noflo/noflo`, `@noflo/assembly`, `@noflo/assembly-utils`), which carries the gate semantics for control ports (noflo/noflo#1094) and the one-firing-rule removal of the `triggering` property (work document #47). The build is deterministic under load: repeated fixture builds produce one output tree, and the four root posts join the strict Jekyll-reference comparison again after having been gap-set exclusions of the firing-model strand (work document #35 updates #19–#22).
- Document building is order-tolerant: no arrival ordering is assumed between the template corpus, the site config, and the documents — documents whose referenced parts have not arrived stay buffered and are retried on later arrivals, matching the 1.x retry semantics without WirePattern.
- Permalinks follow Jekyll semantics: `:title` expands to the slug (source name without extension — a deliberate change from the 1.x name-with-extension quirk), `:month`/`:day` zero-pad, and trailing-slash permalinks write `index.html` into the directory.
- Site root entries split at the static leg: files with YAML front matter render through layouts and liquid (including the paginator), files without front matter and directory trees copy verbatim with underscore/dot exclusions at every level.
- The layout chain contributes the `{{ content }}` substitution only: a layout's own front matter is the layout's variables, not page variables — the Jekyll-generated reference is the contract (a `class: index` on a layout does not reach `page.class`; a page's class comes from its own front matter). The paginator's `previous_page_path` follows the same reference: page 1 of a paginated document is the document itself at its own URL (the site root's `index.html` maps to `/`).

### Removed

- The 1.x CoffeeScript component sources and their `nodeunit` tests, the Grunt toolchain, and the `coffeescript`/`mimetype` dependencies.
- The 0.x graph set (`BuildDocuments`, `ConvertMarkdown`, `CopyFile`, `GetConfig`, `GroupDocuments`, `Jekyll`, `LoadDocuments`, `SaveFile`): group-scraping for post metadata is replaced by path-derived message fields, the split template/variables streams are folded into a single document message, and the separate convert/copy/save graphs are folded into the single build flow.
