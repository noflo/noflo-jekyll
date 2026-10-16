import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Component, fail } from "@noflo/assembly";

/**
 * Copies a source file to the site target directory: reads the file at
 * `msg.path` and writes it to `target/basename(path)`. The v1 static
 * copy is flat (nested source directories would need recursion).
 */
export class CopyStatic extends Component {
  constructor() {
    super({
      description: "Copy a source file to the site target",
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
    const destination = path.join(target, path.basename(msgPath));
    readFile(msgPath, "utf8")
      .then((body) =>
        mkdir(path.dirname(destination), { recursive: true }).then(() =>
          writeFile(destination, body, "utf8"),
        ),
      )
      .then(() => {
        output.sendDone({ out: { errors: [], path: msgPath, destination } });
      })
      .catch((error) => {
        output.sendDone({
          fail: fail(
            { errors: [], path: msgPath },
            error instanceof Error ? error : new Error(String(error)),
          ),
        });
      });
  }
}

export const getComponent = () => new CopyStatic();
