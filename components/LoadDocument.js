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
   */ processMessage(input, output) {
    if (!input.hasData("path")) {
      return;
    }
    const filePath = input.getData("path");
    const source = input.hasData("source") ? input.getData("source") : "";
    readFile(filePath, "utf8")
      .then((body) => {
        output.sendDone({
          out: { errors: [], path: filePath, source, body },
        });
      })
      .catch((error) => {
        output.sendDone({
          fail: fail(
            { errors: [], path: filePath, source },
            error instanceof Error ? error : new Error(String(error)),
          ),
        });
      });
  }
}

export const getComponent = () => new LoadDocument();
