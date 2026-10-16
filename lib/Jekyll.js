import { ComponentLoader, asPromise } from "@noflo/noflo";
import { wrapAssembly } from "@noflo/assembly";
import { createNodeModulesRegistry } from "@noflo/loader-node";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// The wrapAssembly configuration: which regular components join the
// assembly pipeline and how their ports map to message fields (work
// document #36)
const wrapConfig = {
  libraries: [
    {
      library: "markdown",
      mapping: {
        ParseMarkdown: {
          in: { in: "body" },
          out: { out: "html" },
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
        CopyFile: {
          in: { source: "path", destination: "out" },
          out: { out: "copied" },
        },
      },
    },
  ],
};

/**
 * Builds the wrapped component registry for the jekyll pipeline:
 * the package's own relays plus the regular migrated libraries
 * (markdown, liquid, filesystem) wrapped as assembly participants.
 *
 * @param {{ baseDir?: string }} [options]
 * @returns {Promise<ReturnType<typeof wrapAssembly> & { loader: ComponentLoader }>}
 */
export async function createRegistry(options = {}) {
  const root = options.baseDir ?? baseDir;
  const registry = await createNodeModulesRegistry(root, {});
  const wrapped = wrapAssembly(registry, wrapConfig);
  const loader = new ComponentLoader({ registry: wrapped });
  return { ...wrapped, loader };
}

/**
 * Creates the build runner for the jekyll pipeline: an asPromise-wrapped
 * Build graph resolved through the wrapped registry.
 *
 * @param {{ baseDir?: string }} [options]
 * @returns {Promise<(inputs: Record<string, unknown>) => Promise<Record<string, unknown>>>}
 */
export async function createBuild(options = {}) {
  const { loader } = await createRegistry(options);
  const graph = JSON.parse(
    await readFile(path.join(options.baseDir ?? baseDir, "graphs", "Build.json"), "utf8"),
  );
  return asPromise(graph, { loader, name: "jekyll-build" });
}

/**
 * Runs a full Jekyll build: reads the site config from `_config.yml`
 * and runs the Build pipeline from `source` to `target`.
 *
 * @param {string} source Site source directory
 * @param {string} target Site target directory
 * @param {{ baseDir?: string }} [options]
 * @returns {Promise<Record<string, unknown>>} The build output map (`written`, `copied`)
 */
export async function jekyll(source, target, options = {}) {
  const run = await createBuild(options);
  const configRaw = await readFile(path.join(source, "_config.yml"), "utf8");
  const config = { ...parse(configRaw), target };
  return run({ source, target, config });
}
