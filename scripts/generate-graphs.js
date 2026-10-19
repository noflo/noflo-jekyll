/**
 * Generates the 2.x build graphs for the Jekyll pipeline. Run from the
 * package root: `node scripts/generate-graphs.js`. The outputs are
 * committed so the package ships them: the loader's discovery walks the
 * installed package's `components/` and `graphs/` directories directly
 * (work document #24), so no manifest file is needed.
 *
 * The 0.x-era graph set was fragmented by its constraints (groups as
 * metadata, disconnect-driven flushing, WirePattern queues). The 2.x
 * pipeline is one document flow: scan → load → front matter → markdown
 * → metadata → paths → collect → expand → build → liquid → write, with
 * the scan brackets stripped for the per-message wrapped components and
 * re-added to gate the collection.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportFbpJson, GraphModel } from "@noflo/noflo";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string} name
 * @returns {GraphModel}
 */
const newGraph = (name) => new GraphModel({ name });

/**
 * @param {GraphModel} graph
 * @param {string} id
 * @param {string} component
 * @param {Record<string, unknown>} [metadata]
 */
const addNode = (graph, id, component, metadata = {}) => {
  graph.addNode({ entity_id: id, component, metadata });
};

/**
 * Wires one file-loading leg: the scan's bracketed listing is stripped
 * to bare path strings, the ToAssembly envelope turns each into an
 * assembly message (the `assembly.field` node metadata names the
 * field), and the wrapped filesystem/ReadFile reads it — the jekyll
 * LoadDocument relay retires (work document #35 update #23's
 * substitution, enabled by noflo/noflo#1097's ToAssembly field option).
 * @param {GraphModel} graph
 * @param {string} scanPort
 * @param {string} stripId
 * @param {string} toId
 * @param {string} readId
 * @param {{ node: string, port: string }} to
 */
const wireLoadedLeg = (graph, scanPort, prefix, to) => {
  // The load leg: the scan's bracketed listing is stripped to bare path
  // strings, the ToAssembly envelope turns each into an assembly message,
  // the message's path becomes its correlation scope (DuplicateProperty
  // wraps the field, ScopeFromObject consumes it into the IP scope — the
  // wrapped ReadFile is asynchronous, so unscoped in-flight messages
  // would pair positionally and cross, the work document #36 limitation),
  // and the wrapped filesystem/ReadFile reads it. The jekyll LoadDocument
  // relay retires (work document #35 update #23's substitution, enabled
  // by noflo/noflo#1097's ToAssembly field option and the out-mapping
  // null replace).
  addNode(graph, `${prefix}_strip`, "groups/RemoveGroups");
  addNode(graph, `${prefix}_toasm`, "assembly-utils/ToAssembly", {
    "assembly.field": "path",
  });
  addNode(graph, `${prefix}_dup`, "objects/DuplicatePropertyAssembly");
  addNode(graph, `${prefix}_scoper`, "packets/ScopeFromObject");
  addNode(graph, `${prefix}_read`, "filesystem/ReadFileAssembly");
  // DuplicateProperty's property is in "original=new" form (the code's
  // semantics — its description says "new=original", which is inverted):
  // data.scope = data.path. Port defaults are inert under the 2.x
  // engine, so the separator (default "/") is fed too
  graph.addIIP({
    data: "path=scope",
    to: { node: `${prefix}_dup`, port: "property" },
  });
  graph.addIIP({
    data: "/",
    to: { node: `${prefix}_dup`, port: "separator" },
  });
  // Port defaults are inert under the 2.x engine: the wrapped ReadFile's
  // encoding control (default "utf-8") must be fed, or fs.readFile
  // resolves Buffers into the message body
  graph.addIIP({ data: "utf8", to: { node: `${prefix}_read`, port: "encoding" } });
  graph.addEdge({
    from: { node: "scan", port: scanPort },
    to: { node: `${prefix}_strip`, port: "in" },
  });
  graph.addEdge({
    from: { node: `${prefix}_strip`, port: "out" },
    to: { node: `${prefix}_toasm`, port: "in" },
  });
  graph.addEdge({
    from: { node: `${prefix}_toasm`, port: "out" },
    to: { node: `${prefix}_dup`, port: "msg" },
  });
  graph.addEdge({
    from: { node: `${prefix}_dup`, port: "out" },
    to: { node: `${prefix}_scoper`, port: "in" },
  });
  graph.addEdge({
    from: { node: `${prefix}_scoper`, port: "out" },
    to: { node: `${prefix}_read`, port: "msg" },
  });
  graph.addEdge({ from: { node: `${prefix}_read`, port: "out" }, to });
};

/**
 * Wires one filesystem/ReadDir leg for a known source subdirectory.
 * @param {GraphModel} graph
 * @param {string} subDir
 */
const wireReadDir = (graph, subDir) => {
  const stem = subDir.replace(/^_/, "");
  addNode(graph, `join_${stem}`, "filesystem/JoinPath");
  addNode(graph, `read_${stem}`, "filesystem/ReadDir");
  graph.addEdge({
    from: { node: "split", port: "out" },
    to: { node: `join_${stem}`, port: "directory" },
  });
  graph.addIIP({ data: subDir, to: { node: `join_${stem}`, port: "file" } });
  graph.addEdge({
    from: { node: `join_${stem}`, port: "out" },
    to: { node: `read_${stem}`, port: "source" },
  });
};

// The source root itself: static files (the top-level scan leg)
// ---------------------------------------------------------------------------
// jekyll/ScanSource: the source tree scan as bracketed directory streams
// ---------------------------------------------------------------------------
const scan = newGraph("ScanSource");
addNode(scan, "split", "core/Split");
addNode(scan, "read_root", "filesystem/ReadDir");
// The static leg's listing framing is stripped before the export: the
// SplitStatic relay reads entries as pure data, and its consumption
// cannot take forwarded brackets (the head getData eats the open bracket
// and the close strands — update #20's cosmetic residue)
addNode(scan, "strip_static", "groups/RemoveGroups");
scan.addEdge({
  from: { node: "split", port: "out" },
  to: { node: "read_root", port: "source" },
});
scan.addEdge({
  from: { node: "read_root", port: "out" },
  to: { node: "strip_static", port: "in" },
});
scan.addExport({
  direction: "inport",
  public: "source",
  internal: { node: "split", port: "in" },
});
wireReadDir(scan, "_posts");
// The nested discovery: each root entry joined with `/_posts` and read.
// The root listing's brackets are stripped first — the Append's standing
// suffix must not carry the listing's framing (it would nest the nested
// listings inside the root listing's frame and strand the frame close on
// the silent sends), and the nested listings re-frame per directory
addNode(scan, "strip_nested", "groups/RemoveGroups");
addNode(scan, "append_nested", "strings/Append");
addNode(scan, "read_nested", "filesystem/ReadDir");
scan.addEdge({
  from: { node: "read_root", port: "out" },
  to: { node: "strip_nested", port: "in" },
});
scan.addEdge({
  from: { node: "strip_nested", port: "out" },
  to: { node: "append_nested", port: "in" },
});
scan.addIIP({
  data: "/_posts",
  to: { node: "append_nested", port: "append" },
});
scan.addEdge({
  from: { node: "append_nested", port: "out" },
  to: { node: "read_nested", port: "source" },
});
scan.addExport({
  direction: "outport",
  public: "posts_nested",
  internal: { node: "read_nested", port: "out" },
});
wireReadDir(scan, "_layouts");
wireReadDir(scan, "_includes");

scan.addExport({
  direction: "outport",
  public: "posts",
  internal: { node: "read_posts", port: "out" },
});
scan.addExport({
  direction: "outport",
  public: "layouts",
  internal: { node: "read_layouts", port: "out" },
});
addNode(scan, "kick_incl", "core/Kick");
scan.addIIP({
  data: null,
  to: { node: "kick_incl", port: "data" },
});
scan.addEdge({
  from: { node: "read_includes", port: "error" },
  to: { node: "kick_incl", port: "in" },
});
scan.addExport({
  direction: "outport",
  public: "includes_ready",
  internal: { node: "kick_incl", port: "out" },
});
scan.addExport({
  direction: "outport",
  public: "includes",
  internal: { node: "read_includes", port: "out" },
});
scan.addExport({
  direction: "outport",
  public: "static",
  internal: { node: "strip_static", port: "out" },
});

// ---------------------------------------------------------------------------
// jekyll/Build: the full document pipeline
// ---------------------------------------------------------------------------
const build = newGraph("Build");
addNode(build, "scan", "jekyll/ScanSource");
// The posts leg fans in two bracketed listings (the root _posts and the
// discovered nested ones); the envelope merges them into one outer
// bracket frame that closes at the leg's EOT, so the collector flushes
// once over the complete collection — one source group completing is
// not the collection being complete
addNode(build, "envelope", "jekyll/StreamEnvelope");
wireLoadedLeg(build, "posts", "posts", {
  node: "envelope",
  port: "msg",
});
// The nested _posts discovery's listing joins the root listing on the
// same load leg: both brackets are stripped, both paths scope and load
build.addEdge({
  from: { node: "scan", port: "posts_nested" },
  to: { node: "posts_strip", port: "in" },
});
addNode(build, "frontmatter", "jekyll/FrontMatter");
addNode(build, "metadata", "jekyll/PathMetadata");
addNode(build, "buildpath", "jekyll/BuildPostPath");
addNode(build, "collect", "jekyll/PostCollector");
addNode(build, "expand", "jekyll/ExpandPosts");
addNode(build, "markdown", "markdown/ParseMarkdownAssembly");
addNode(build, "builder", "jekyll/DocumentBuilder");
addNode(build, "liquid", "liquid/TemplateAssembly");
addNode(build, "dirname", "filesystem/DirNameAssembly");
addNode(build, "mkdir", "filesystem/MakeDirAssembly");
addNode(build, "frontmatter_tpl", "jekyll/FrontMatter");
addNode(build, "frontmatter_incl", "jekyll/FrontMatter");
// The template corpus (layouts + includes listings) merges into one
// outer-framed stream for the builder's control gate: the control buffer
// keeps the latest stream, so two separate listing groups would discard
// each other. The includes stay separately stripped for the liquid
// engine's include registration
addNode(build, "corpus_envelope", "jekyll/StreamEnvelope");
addNode(build, "strip_incl", "groups/RemoveGroups");
addNode(build, "write", "filesystem/WriteFileAssembly");
addNode(build, "copystatic", "jekyll/CopyStatic");
addNode(build, "splitstatic", "jekyll/SplitStatic");
addNode(build, "frontmatter_page", "jekyll/FrontMatter");

// Scan wiring: the posts leg into the per-document pipeline


// The template corpus: both legs load into the builder's template
// store — through FrontMatter, so layouts arrive with their own front
// matter parsed (the layout chain) and bodies stripped; the include
// corpus also registers into the liquid engine's runtime includes
wireLoadedLeg(build, "layouts", "layouts", {
  node: "frontmatter_tpl",
  port: "msg",
});
wireLoadedLeg(build, "includes", "includes", {
  node: "frontmatter_incl",
  port: "msg",
});
build.addEdge({
  from: { node: "frontmatter_tpl", port: "out" },
  to: { node: "corpus_envelope", port: "msg" },
});
build.addEdge({
  from: { node: "frontmatter_incl", port: "out" },
  to: { node: "corpus_envelope", port: "msg" },
});
build.addEdge({
  from: { node: "corpus_envelope", port: "out" },
  to: { node: "builder", port: "templates" },
});
build.addEdge({
  from: { node: "frontmatter_incl", port: "out" },
  to: { node: "strip_incl", port: "in" },
});
build.addEdge({
  from: { node: "scan", port: "includes_ready" },
  to: { node: "liquid", port: "includes" },
});
build.addEdge({
  from: { node: "strip_incl", port: "out" },
  to: { node: "liquid", port: "includes" },
});

// The per-document pipeline
build.addEdge({
  from: { node: "envelope", port: "out" },
  to: { node: "frontmatter", port: "msg" },
});
build.addEdge({
  from: { node: "frontmatter", port: "out" },
  to: { node: "metadata", port: "msg" },
});
build.addEdge({
  from: { node: "metadata", port: "out" },
  to: { node: "buildpath", port: "msg" },
});
build.addEdge({
  from: { node: "buildpath", port: "out" },
  to: { node: "collect", port: "msg" },
});

// Phase 2: the flushed config expands into per-post build messages
build.addEdge({
  from: { node: "collect", port: "out" },
  to: { node: "expand", port: "msg" },
});
build.addEdge({
  from: { node: "expand", port: "config" },
  to: { node: "builder", port: "config" },
});
// The per-message scopes are stock: DuplicateProperty wraps the post's
// path into a `scope` field (the whole-message mapping, the replace
// semantics of the out-mapping null), and ScopeFromObject consumes the
// field into the IP scope — the wrapped adapters downstream correlate
// per scope, so concurrent in-flight posts cannot cross pairs
build.addEdge({
  from: { node: "expand", port: "out" },
  to: { node: "markdown", port: "msg" },
});
build.addEdge({
  from: { node: "markdown", port: "out" },
  to: { node: "builder", port: "msg" },
});

// Build → liquid render → ensure the target directory exists → write.
// The message flows sequentially through the dirname and mkdir relays,
// so the write wrapper only sees messages whose directory exists
build.addEdge({
  from: { node: "builder", port: "out" },
  to: { node: "liquid", port: "msg" },
});
build.addEdge({
  from: { node: "liquid", port: "out" },
  to: { node: "dirname", port: "msg" },
});
build.addEdge({
  from: { node: "dirname", port: "out" },
  to: { node: "mkdir", port: "msg" },
});
build.addEdge({
  from: { node: "mkdir", port: "out" },
  to: { node: "write", port: "msg" },
});

// The static leg: root entries split into front-matter pages (routed
// through the document pipeline) and verbatim copies
build.addEdge({
  from: { node: "scan", port: "static" },
  to: { node: "splitstatic", port: "msg" },
});
build.addEdge({
  from: { node: "splitstatic", port: "static" },
  to: { node: "copystatic", port: "msg" },
});
build.addEdge({
  from: { node: "splitstatic", port: "page" },
  to: { node: "frontmatter_page", port: "msg" },
});
build.addEdge({
  from: { node: "frontmatter_page", port: "out" },
  to: { node: "builder", port: "msg" },
});

// The site source/target come in from the CLI
build.addExport({
  direction: "inport",
  public: "source",
  internal: { node: "scan", port: "source" },
});
build.addExport({
  direction: "inport",
  public: "target",
  internal: { node: "copystatic", port: "target" },
});

build.addExport({
  direction: "outport",
  public: "written",
  internal: { node: "write", port: "out" },
});
build.addExport({
  direction: "outport",
  public: "copied",
  internal: { node: "copystatic", port: "out" },
});
// The builder's fail port is wired out: a page whose build throws must
// surface in the build result, not vanish into an unconnected outport
// (the work document #35 update #12 footgun — the anomaly investigation
// showed root pages silently lost through their builds throwing)
build.addExport({
  direction: "outport",
  public: "failed",
  internal: { node: "builder", port: "fail" },
});

mkdirSync(join(pkgRoot, "graphs"), { recursive: true });
for (const [name, graph] of [
  ["ScanSource", scan],
  ["Build", build],
]) {
  const file = join(pkgRoot, "graphs", `${name}.json`);
  writeFileSync(file, `${JSON.stringify(exportFbpJson(graph), null, 2)}\n`);
  console.log(`${file} written`);
}
