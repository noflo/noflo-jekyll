import { readFile } from "node:fs/promises";
import { Component, fail } from "@noflo/assembly";

/**
 * Reads a source file and emits it as a document message: the file's
 * relative path plus its raw contents on `body`. Front-matter parsing
 * happens downstream, keeping this relay a plain byte-to-message gate.
 */
export class LoadDocument extends Component {
  constructor() {
    super({
      description: "Read a source document into a message",
      icon: "file-text-o",
      inPorts: {
        path: {
          datatype: "string",
          description: "Absolute or source-relative file path",
          required: true,
        },
        source: {
          datatype: "string",
          description: "Site source directory the path is relative to",
          required: false,
          control: true,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "Document message with path and raw body",
        },
        fail: {
          datatype: "object",
          description: "The path message with the read error accumulated",
        },
      },
    });
  }

  /** @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output */
  forwardBrackets = { path: ["out", "fail"] };

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output
   * @returns {Promise<{ out?: Record<string, unknown>, fail?: Record<string, unknown> } | undefined>} The
   *   activation contract: the read is asynchronous, so the promise is
   *   returned and the send happens in-activation when it resolves. A
   *   void return means "already sent" — the deferred sendDone inside the
   *   callback raced drain-based closing and re-opened the ended network
   *   (the noflo/noflo #1092 review corpus race)
   */
  processMessage(input, output) {
    if (!input.hasData("path")) {
      return Promise.resolve(undefined);
    }
    const filePath = input.getData("path");
    const source = input.hasData("source") ? input.getData("source") : "";
    return readFile(filePath, "utf8").then(
      (body) => ({
        out: { errors: [], path: filePath, source, body },
      }),
      (error) => ({
        fail: fail(
          { errors: [], path: filePath, source },
          error instanceof Error ? error : new Error(String(error)),
        ),
      }),
    );
  }
}

export const getComponent = () => new LoadDocument();
