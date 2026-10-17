# noflo-jekyll

[![Test](https://github.com/noflo/noflo-jekyll/actions/workflows/test.yml/badge.svg)](https://github.com/noflo/noflo-jekyll/actions/workflows/test.yml)

Flow-based reimplementation of the [Jekyll](https://jekyllrb.com/) static site generator as a [NoFlo](https://noflojs.org/) graph, running on the NoFlo 2.x line: plain ESM with no build step, Node.js 22 or later, and deterministic stream semantics (one firing rule for all ports, gate semantics for control ports, drain-based network closing).

The pipeline is also the reference proof of concept for building real applications from migrated NoFlo 2.x component libraries: the per-message transformations run through assembly-wrapped standard components (`markdown/ParseMarkdown`, `liquid/Template`, `filesystem/ReadFile`, `filesystem/WriteFile`, `filesystem/MakeDir`, `filesystem/DirName`), the application's own semantics live in a small set of assembly-relay components, and the wiring is two graphs (`jekyll/Build` and its `jekyll/ScanSource` source-tree scan subgraph).

Because everything is a NoFlo graph, the build is pluggable in the usual dataflow ways: other data sources than the file system (a database query result is just another stream), other Markdown or template engines (swap the wrapped component), and embedding as a library, as a graph in another NoFlo application, or as a command-line executable.

## Installation

As a command-line executable:

    $ npm install -g @noflo/jekyll

As a library dependency:

    $ npm install @noflo/jekyll

## Command-line usage

The command-line contract is the same as Jekyll's basic build:

    $ noflo-jekyll source_dir target_dir

## Usage in Node.js applications

The build is exposed as a promise-based function:

``` javascript
import { jekyll } from "@noflo/jekyll";

const output = await jekyll("source_dir", "target_dir");
for (const file of output.written) {
  console.log(`Created ${file.path}`);
}
for (const file of output.copied) {
  console.log(`Copied ${file.destination}`);
}
```

The build closes its network down on its own when every input has reached end of transmission, so the promise resolves exactly when the site is complete — there is no timeout or forced stop.

## Usage in NoFlo graphs

The main site generation flow is exposed as the `jekyll/Build` graph. Here is a simple example of using it in another graph:

``` fbp
# Directory setup
'/some/source/directory' -> SOURCE Build(jekyll/Build)
'/some/target/directory' -> TARGET Build()

# Outputs
Build() WRITTEN -> IN Drop(core/Drop)
Build() COPIED -> IN Display(core/Output)
```

## Deterministic builds

The build is deterministic: repeated builds of the same site produce byte-identical output trees, verified by a stress loop and by the CI suite. The pipeline leans on the NoFlo 2.x engine's guarantees — per-message scope correlation through assembly-wrapped components, control ports as standing-configuration gates, and boundary-owned end-of-transmission — and the wrapping layer (`@noflo/assembly`) lets the migrated component libraries participate in assembly-style error accumulation without rewriting them.

## Known issues and differences with Ruby Jekyll

### Byte parity

The test suite builds a fixture site with noflo-jekyll and compares the output tree against the same site generated with Ruby Jekyll 3.9. The output is byte-identical modulo one documented difference: the fixture was generated with the `rdiscount` Markdown engine, while the 2.x build uses the `commonmark` reference parser, which formats paragraphs with compact spacing. The comparison normalizes blank lines for text files and compares binaries bytewise.

### Template incompatibilities

The template engine is [liquidjs](https://github.com/harttle/liquidjs), which covers the Liquid spec far more completely than the 1.x-era engine. The Jekyll filters and the `{% include %}` tag are implemented on top of it. If a template construct does not work, please [report an issue](https://github.com/noflo/noflo-jekyll/issues).

### Newer Jekyll features

Not yet implemented:

* Nested front-matter pages (a front-matter page inside a subdirectory is currently copied verbatim by the static leg)
* Draft posts
* Timezones
* Baseurl

Please report any [issues you encounter](https://github.com/noflo/noflo-jekyll/issues) with these or other Jekyll features.

### No web server

The Ruby Jekyll includes a rudimentary web server for testing purposes. As that is outside the scope of static site generation, this feature is not part of the implementation. Serve the generated pages with any static file server.

## Testing and development

The test suite runs on Node's built-in test runner, with TypeScript type checks and Biome linting:

    $ npm test

The main body of tests is a parity suite: a Jekyll website source in `test/fixtures/source` was generated to a static site with Ruby Jekyll 3.9, and the build is compared against that reference tree. Files whose build output depends on not-yet-implemented features are kept visible as test todos instead of silent exclusions, so the strict comparison fails the moment an unexpected deviation appears.

If you find something noflo-jekyll doesn't handle correctly, add it to the fixture site source, regenerate the reference with Ruby Jekyll 3.9 into `test/fixtures/jekyll`, and add the affected files to the comparison.
