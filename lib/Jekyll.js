import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wrapAssembly } from "@noflo/assembly";
import { createNodeModulesRegistry } from "@noflo/loader-node";
import { asPromise, ComponentLoader, importFbpJson } from "@noflo/noflo";
import { parse } from "yaml";

const baseDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {Object} JekyllBuildResult
 * @property {unknown[]} [written] The written file messages
 * @property {unknown[]} [copied] The copied file messages
 */

/**
 * The wrapAssembly configuration: which regular components join the
 * assembly pipeline and how their ports map to message fields (work
 * document #36).
 * @type {Record<string, unknown>} // WrapAssemblyConfig
 */
const wrapConfig = {
  libraries: [
    {
      library: "markdown",
      mapping: {
        ParseMarkdown: {
          in: { in: "body" },
          out: { out: "body" },
        },
      },
    },
    {
      library: "liquid",
      mapping: {
        Template: {
          in: { template: "template", variables: null },
          out: { out: "output" },
        },
      },
    },
    {
      library: "filesystem",
      mapping: {
        WriteFile: {
          in: { in: "output", filename: "path" },
          out: { out: "written" },
        },
        DirName: {
          in: { in: "path" },
          out: { out: "dir" },
        },
        MakeDir: {
          in: { in: "dir" },
          out: { out: "dir" },
        },
      },
    },
  ],
};

/**
 * Builds the wrapped component registry for the jekyll pipeline.
 *
 * @param {{ baseDir?: string, flowtrace?: object }} [options]
 * @returns {Promise<{ graph: import("@noflo/graph").GraphModel, loader: ComponentLoader }>}
 */
export async function createBuild(options = {}) {
  const root = options.baseDir ?? baseDir;
  const registry = await createNodeModulesRegistry(root, {});
  const wrapped = wrapAssembly(registry, {
    ...wrapConfig,
    onSkip: (/** @type {{ name: string, reason: string }} */ skip) => {
      console.error("[wrapAssembly] skipped " + skip.name + ": " + skip.reason);
    },
  });
  const loader = new ComponentLoader({ registry: wrapped });
  const graphJson = JSON.parse(
    await readFile(path.join(root, "graphs", "Build.json"), "utf8"),
  );
  // A live GraphModel instance: asPromise passes it straight to the
  // network; a raw JSON object would fall through to a component lookup
  const graph = importFbpJson(graphJson);
  return { graph, loader };
}

/**
 * Runs a full Jekyll build: reads the site config from `_config.yml`,
 * injects it as IIPs into the graph model (so every component that needs
 * it gets the buffered control), and runs the Build pipeline via
 * `asPromise`.
 *
 * @param {string} source Site source directory
 * @param {string} target Site target directory
 * @param {{ baseDir?: string, flowtrace?: object }} [options]
 * @returns {Promise<JekyllBuildResult>} The build output map
 */
export async function jekyll(source, target, options = {}) {
  const configRaw = await readFile(path.join(source, "_config.yml"), "utf8");
  /** @type {Record<string, unknown>} */
  const config = { ...parse(configRaw), target, time: new Date() };
  const { graph, loader } = await createBuild(options);
  // The config reaches every component that needs it as graph-level IIPs
  graph.addIIP({ data: config, to: { node: "collect", port: "config" } });
  // The source reaches PathMetadata's category rule (the segments above
  // a nested _posts directory are relative to the site source)
  graph.addIIP({ data: source, to: { node: "metadata", port: "source" } });
  graph.addIIP({ data: config, to: { node: "buildpath", port: "config" } });
  graph.addIIP({ data: config, to: { node: "copystatic", port: "target" } });
  graph.addIIP({ data: config, to: { node: "splitstatic", port: "config" } });
  const run = asPromise(graph, {
    loader,
    name: "jekyll-build",
    flowtrace: options.flowtrace,
  });
  const output = await run({ source, target });
  return /** @type {JekyllBuildResult} */ (output);
}
