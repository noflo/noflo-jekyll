import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Component, fail } from "@noflo/assembly";

/**
 * Copies a source entry to the site target directory: files are copied
 * to `target/basename(path)`, directories recursively — skipping the
 * Jekyll-ignored underscore and dot entries at every level, the way
 * Jekyll's site copy excludes `_posts` and friends anywhere in the
 * tree.
 */
export class CopyStatic extends Component {
  constructor() {
    super({
      description: "Copy a source file or directory to the site target",
      icon: "files-copy",
      inPorts: {
        msg: {
          datatype: "string",
          description: "Source file path to copy",
          required: true,
        },
        target: {
          datatype: "string",
          description: "Site target directory",
          required: false,
          control: true,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "The message with the destination recorded",
        },
        fail: {
          datatype: "object",
          description: "The message with the error accumulated",
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

  /**
   * Recursively copies a directory tree, skipping ignored entries at
   * every level.
   * @param {string} src
   * @param {string} dest
   * @returns {Promise<void>}
   */
  async copyTree(src, dest) {
    const entries = await readdir(src);
    for (const entry of entries) {
      if (this.isIgnored(entry)) {
        continue;
      }
      const from = path.join(src, entry);
      const to = path.join(dest, entry);
      const info = await stat(from);
      if (info.isDirectory()) {
        await this.copyTree(from, to);
        continue;
      }
      // The destination directory is created lazily, with the first
      // copyable entry: an ignored-only tree (baz/ holding just
      // _posts) leaves nothing behind, and a directory the document
      // pipeline also writes into is never removed
      await mkdir(dest, { recursive: true });
      const body = await readFile(from);
      await writeFile(to, body);
    }
  }

  /** @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output */
  processMessage(input, output) {
    if (!input.hasData("msg")) {
      return;
    }
    const msgPath = input.getData("msg");
    const target = input.hasData("target")
      ? input.getData("target")
      : undefined;
    if (!target) {
      output.sendDone({
        fail: fail(
          { errors: [], path: msgPath },
          new Error("CopyStatic requires the site target"),
        ),
      });
      return;
    }
    if (this.isIgnored(msgPath)) {
      // Jekyll-ignored: skip silently, nothing to emit
      output.done();
      return;
    }
    const destination = path.join(target, path.basename(msgPath));
    // The activation contract: the copy is asynchronous, so the promise is
    // returned and the send happens in-activation when it resolves. A void
    // return means "already sent" — the deferred sendDone inside the
    // callback raced drain-based closing (the noflo/noflo #1092 review)
    return stat(msgPath)
      .then((info) => {
        if (info.isDirectory()) {
          // Directory tree: copy recursively, skipping ignored entries
          return this.copyTree(msgPath, destination);
        }
        return readFile(msgPath, "utf8").then((body) =>
          mkdir(path.dirname(destination), { recursive: true }).then(() =>
            writeFile(destination, body, "utf8"),
          ),
        );
      })
      .then(
        () => ({ out: { errors: [], path: msgPath, destination } }),
        (error) => ({
          fail: fail(
            { errors: [], path: msgPath },
            error instanceof Error ? error : new Error(String(error)),
          ),
        }),
      );
  }
}

export const getComponent = () => new CopyStatic();
