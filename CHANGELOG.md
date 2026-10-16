# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- NoFlo 2.x reimplementation of the Jekyll static site generator on the `2.x` branch: plain ESM with zero build step, Node.js >= 22, components built on the `@noflo/assembly` message-relay conventions (assembly `Component` base class, `errors` array, `fail`/`failed` helpers) instead of the 1.x WirePattern queues.
- New component set: `jekyll/LoadDocument`, `jekyll/FrontMatter`, `jekyll/PathMetadata`, `jekyll/BuildPostPath`, `jekyll/PostCollector` (stateless collect-until-stream-close), `jekyll/ExpandPosts`, `jekyll/DocumentBuilder` (template inheritance and pagination), `jekyll/CopyStatic`, and the `jekyll/ScanSource` source-tree scan subgraph.
- Redesigned graph set: a single `Build` pipeline graph plus the `ScanSource` subgraph, generated with `scripts/generate-graphs.js` and committed for the package manifest. The 0.x eight-graph set is replaced by message-shaped relay wiring with transport-level brackets.
- `lib/Jekyll` embedding library on the 2.x network API (`asPromise` with a live `GraphModel`), the `bin/noflo-jekyll` CLI with an unchanged command-line contract (`noflo-jekyll source target`), and `scripts/generate-graphs.js`.
- Test suite on `node:test`: per-component units and an end-to-end fixture-site build test pinning the expected build outputs.
- Behavior parity is asserted against the 1.x fixtures, including the 1.x name-with-extension permalink quirk (`:title` keeping `.md`).

### Changed

- Dependencies moved to the `@noflo` namespace (`@noflo/noflo`, `@noflo/assembly`, `@noflo/assembly-utils`, `@noflo/core`, `@noflo/filesystem`, `@noflo/groups`, `@noflo/liquid`, `@noflo/markdown`), all on the 2.x line; site config parsing uses `yaml`.
- Document building is order-tolerant: no arrival ordering is assumed between the template corpus, the site config, and the documents — documents whose referenced parts have not arrived stay buffered and are retried on later arrivals, matching the 1.x retry semantics without WirePattern.
- Permalinks follow Jekyll semantics: `:title` expands to the slug (source name without extension — a deliberate change from the 1.x name-with-extension quirk), `:month`/`:day` zero-pad, and trailing-slash permalinks write `index.html` into the directory.
- Site root entries split at the static leg: files with YAML front matter render through layouts and liquid (including layout-chain variable inheritance and the paginator), files without front matter and directory trees copy verbatim with underscore/dot exclusions at every level.

### Removed

- The 1.x CoffeeScript component sources and their `nodeunit` tests, the Grunt toolchain, and the `coffeescript`/`mimetype` dependencies.
- The 0.x graph set (`BuildDocuments`, `ConvertMarkdown`, `CopyFile`, `GetConfig`, `GroupDocuments`, `Jekyll`, `LoadDocuments`, `SaveFile`): group-scraping for post metadata is replaced by path-derived message fields, the split template/variables streams are folded into a single document message, and the separate convert/copy/save graphs are folded into the single build flow.
