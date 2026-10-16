import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { Component, fail } from "@noflo/assembly";

/**
 * Walks the site source tree and emits classified file messages:
 *
 * - `post`: markdown files under `_posts/` (the document pipeline)
 * - `template`: files under `_layouts/` and `_includes/` (the template
 *   corpus for DocumentBuilder)
 * - `static`: everything else (copied verbatim to the target)
 *
 * Each message carries the absolute source `path` and the `out` path the
 * file writes to under the target. A `completed` bang fires after the
 * walk — the graph wires it to the collection flush, making the
 * phase boundary explicit instead of disconnect-driven like 1.x.
 */
export class ScanSource extends Component {
  constructor() {
    super({
      description:
        "Walk the site source tree and emit classified file messages",
      icon: "folder-open",
      inPorts: {
        source: {
          datatype: "string",
          description: "Site source directory",
          required: true,
        },
        target: {
          datatype: "string",
          description: "Site target directory (for static file destinations)",
          required: true,
        },
      },
      outPorts: {
        post: {
          datatype: "object",
          description: "Post file message with path and out",
        },
        template: {
          datatype: "object",
          description: "Template file message with path",
        },
        static: {
          datatype: "object",
          description: "Static file message with path and out",
        },
        completed: {
          datatype: "bang",
          description: "Fires after the whole tree is walked",
        },
        fail: {
          datatype: "object",
          description: "The walk configuration with the error accumulated",
        },
      },
    });
  }

  /**
   * @param {string} dir
   * @param {string} source
   * @param {string} target
   * @param {{ errors: unknown[], path: string, out: string }} base
   * @param {{ post: Function, template: Function, static: Function }} emit
   * @returns {Promise<void>}
   */
  async walk(dir, source, target, base, emit) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith("_") &&
          entry.name !== "_posts" &&
          entry.name !== "_layouts" &&
          entry.name !== "_includes"
        ) {
          // Underscore directories other than the known ones are private
          continue;
        }
        await this.walk(full, source, target, base, emit);
        continue;
      }
      const relSource = relative(source, full);
      if (entry.name.startsWith("_")) {
        // Private files (dotfiles, partials) are not copied
        continue;
      }
      if (relSource.startsWith("_posts") && /\.md$/.test(entry.name)) {
        emit.post({ ...base, path: full });
        continue;
      }
      if (
        relSource.startsWith("_layouts") ||
        relSource.startsWith("_includes")
      ) {
        emit.template({ ...base, path: full });
        continue;
      }
      emit.static({ ...base, path: full, out: join(target, relSource) });
    }
  }

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, send(map: Record<string, unknown>): void, done(err?: Error): void }} output
   * @returns {void}
   */
  processMessage(input, output) {
    if (!input.hasData("source", "target")) {
      return;
    }
    const [source, target] = input.getData("source", "target");
    stat(source)
      .then(async (stats) => {
        if (!stats.isDirectory()) {
          throw new Error(`${source} is not a directory`);
        }
        /** @type {{ errors: unknown[], path: string, out: string }} */
        const base = { errors: [], path: "", out: "" };
        const emit = {
          post: (/** @type {Record<string, unknown>} */ msg) =>
            output.send({ post: msg }),
          template: (/** @type {Record<string, unknown>} */ msg) =>
            output.send({ template: msg }),
          static: (/** @type {Record<string, unknown>} */ msg) =>
            output.send({ static: msg }),
        };
        await this.walk(source, source, target, base, emit);
        output.send({ completed: true });
        output.done();
      })
      .catch((error) => {
        output.sendDone({
          fail: fail(
            { errors: [], path: source, out: target },
            error instanceof Error ? error : new Error(String(error)),
          ),
        });
      });
  }
}

export const getComponent = () => new ScanSource();
