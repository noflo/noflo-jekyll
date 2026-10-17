import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Component, fail } from "@noflo/assembly";

// Jekyll front matter: --- ... --- (YAML) at the top of the file; the
// newline before the closing fence is optional so empty front matter
// (--- --- on consecutive lines) matches
const frontMatterMatcher = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?/;

/**
 * Splits the site root's entries into pages and static copies: entries
 * with YAML front matter are pages (routed into the document pipeline
 * for layout and liquid rendering), everything else — plain files and
 * directories — is copied verbatim. Jekyll-ignored entries (underscore
 * and dot names) are skipped entirely.
 */
export class SplitStatic extends Component {
  constructor() {
    super({
      description: "Split site root entries into pages and static copies",
      icon: "random",
      inPorts: {
        msg: {
          datatype: "string",
          description: "Source entry path",
          required: true,
        },
        config: {
          datatype: "object",
          description: "Site config with target",
          required: false,
          control: true,
        },
      },
      outPorts: {
        page: {
          datatype: "object",
          description: "Document message with raw body for a front-matter page",
        },
        static: {
          datatype: "string",
          description: "Entry path to copy verbatim",
        },
        fail: {
          datatype: "object",
          description: "The entry with the error accumulated",
        },
      },
    });
  }

  /**
   * Whether Jekyll would ignore this entry: names starting with an
   * underscore or a dot.
   * @param {string} entryPath
   * @returns {boolean}
   */
  isIgnored(entryPath) {
    const base = path.basename(entryPath);
    return base.startsWith("_") || base.startsWith(".");
  }

  /** @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input @param {{ send(map: Record<string, unknown>): void, sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output */
  processMessage(input, output) {
    if (!input.hasData("msg")) {
      return;
    }
    const entryPath = input.getData("msg");
    const config = input.hasData("config")
      ? input.getData("config")
      : undefined;
    if (!config?.target) {
      output.sendDone({
        fail: fail(
          { errors: [], path: entryPath },
          new Error("SplitStatic requires the site target"),
        ),
      });
      return;
    }
    if (this.isIgnored(entryPath)) {
      // Jekyll-ignored: skip silently, nothing to emit
      output.done();
      return;
    }
    // The activation contract: the classification is asynchronous, so the
    // promise is returned and the sends happen in-activation while it is
    // pending; the chain resolves undefined and the bridge completes the
    // activation (the noflo/noflo #1092 review)
    return stat(entryPath)
      .then((info) => {
        if (info.isDirectory()) {
          output.send({ static: entryPath });
          return undefined;
        }
        return readFile(entryPath, "utf8").then((body) => {
          if (!frontMatterMatcher.test(body)) {
            // No front matter: a plain static file
            output.send({ static: entryPath });
            return undefined;
          }
          // A page: routed into the document pipeline; the output path
          // follows Jekyll's page URL convention (verified against the
          // 3.9-generated reference): HTML pages write directory-style
          // (404.html → 404/index.html) under a directory-style site
          // permalink, the root index stays at the root, and non-HTML
          // pages keep their file name
          const rel = path.basename(entryPath);
          const ext = path.extname(rel);
          let outPath;
          if (ext === ".html") {
            const base = path.basename(rel, ext);
            outPath =
              base === "index"
                ? path.join(config.target, "index.html")
                : path.join(config.target, base, "index.html");
          } else {
            outPath = path.join(config.target, rel);
          }
          output.send({
            page: {
              errors: [],
              path: outPath,
              body,
            },
          });
          return undefined;
        });
      })
      .then(
        () => undefined,
        (error) => ({
          fail: fail(
            { errors: [], path: entryPath },
            error instanceof Error ? error : new Error(String(error)),
          ),
        }),
      );
  }
}

export const getComponent = () => new SplitStatic();
