/**
 * Generates the 2.x build graphs for the Jekyll pipeline. Run from the
 * package root: `node scripts/generate-graphs.js`. The outputs are
 * committed so the package manifest (`noflo.json`) can ship them.
 *
 * The 0.x-era graph set was fragmented by its constraints (groups as
 * metadata, disconnect-driven flushing, WirePattern queues). The 2.x
 * pipeline is one document flow: scan → load → front matter → markdown
 * → metadata → paths → collect → expand → build → liquid → write, with
 * the scan brackets stripped for the per-message wrapped components and
 * re-added to gate the collection.
 */
import { GraphModel, exportFbpJson } from "@noflo/noflo";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// ---------------------------------------------------------------------------
// jekyll/ScanSource: the source tree scan as bracketed directory streams
// ---------------------------------------------------------------------------
const scan = newGraph("ScanSource");
addNode(scan, "split", "core/Split");
scan.addExport({
  direction: "inport",
  public: "source",
  internal: { node: "split", port: "in" },
});
wireReadDir(scan, "_posts");
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
scan.addExport({
  direction: "outport",
  public: "includes",
  internal: { node: "read_includes", port: "out" },
});

// ---------------------------------------------------------------------------
// jekyll/Build: the full document pipeline
// ---------------------------------------------------------------------------
const build = newGraph("Build");
addNode(build, "scan", "jekyll/ScanSource");
addNode(build, "strip_brackets", "groups/RemoveGroups");
addNode(build, "load_post", "jekyll/LoadDocument");
addNode(build, "frontmatter", "jekyll/FrontMatter");
addNode(build, "markdown", "markdown/ParseMarkdown");
addNode(build, "metadata", "jekyll/PathMetadata");
addNode(build, "buildpath", "jekyll/BuildPostPath");
addNode(build, "regroup", "groups/Group");
addNode(build, "collect", "jekyll/PostCollector");
addNode(build, "expand", "jekyll/ExpandPosts");
addNode(build, "builder", "jekyll/DocumentBuilder");
addNode(build, "liquid", "liquid/Template");
addNode(build, "load_layout", "jekyll/LoadDocument");
addNode(build, "write", "filesystem/WriteFile");

// Scan wiring: the posts leg into the per-document pipeline
build.addEdge({
  from: { node: "scan", port: "posts" },
  to: { node: "strip_brackets", port: "in" },
});
build.addEdge({
  from: { node: "strip_brackets", port: "out" },
  to: { node: "load_post", port: "path" },
});

// The template corpus: both legs load into the builder's template store
build.addEdge({
  from: { node: "scan", port: "layouts" },
  to: { node: "load_layout", port: "path" },
});
build.addEdge({
  from: { node: "scan", port: "includes" },
  to: { node: "load_layout", port: "path" },
});
build.addEdge({
  from: { node: "load_layout", port: "out" },
  to: { node: "builder", port: "templates" },
});

// The per-document pipeline
build.addEdge({
  from: { node: "load_post", port: "out" },
  to: { node: "frontmatter", port: "msg" },
});
build.addEdge({
  from: { node: "frontmatter", port: "out" },
  to: { node: "markdown", port: "msg" },
});
build.addEdge({
  from: { node: "markdown", port: "out" },
  to: { node: "metadata", port: "msg" },
});
build.addEdge({
  from: { node: "metadata", port: "out" },
  to: { node: "buildpath", port: "msg" },
});
build.addEdge({
  from: { node: "buildpath", port: "out" },
  to: { node: "regroup", port: "in" },
});
build.addEdge({
  from: { node: "regroup", port: "out" },
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
build.addEdge({
  from: { node: "expand", port: "out" },
  to: { node: "builder", port: "msg" },
});

// Build → liquid render → write
build.addEdge({
  from: { node: "builder", port: "out" },
  to: { node: "liquid", port: "msg" },
});
build.addEdge({
  from: { node: "liquid", port: "out" },
  to: { node: "write", port: "msg" },
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
  internal: { node: "scan", port: "target" },
});
build.addExport({
  direction: "outport",
  public: "written",
  internal: { node: "write", port: "out" },
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
