import { Component, fail } from "@noflo/assembly";
import { parse } from "yaml";

// Jekyll front matter: --- ... --- (YAML) at the top of the file
const frontMatterMatcher = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Splits a raw document body into YAML front matter and the markdown
 * body: the front matter is parsed as YAML onto the message, the
 * remainder becomes `body`.
 */
export class FrontMatter extends Component {
  constructor() {
    super({
      description: "Split YAML front matter from a document body",
      icon: "file-text-o",
      inPorts: {
        msg: {
          datatype: "object",
          description: "Document message with a raw body",
          required: true,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description:
            "The message with front-matter fields applied and body trimmed",
        },
        fail: {
          datatype: "object",
          description: "The message with the parse error accumulated",
        },
      },
    });
  }

  /** @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output */
  processMessage(input, output) {
    if (!input.hasData("msg")) {
      return;
    }
    const msg = input.getData("msg");
    const match = frontMatterMatcher.exec(msg.body ?? "");
    if (!match) {
      // No front matter: the body passes through untouched
      output.sendDone({ out: msg });
      return;
    }
    let frontMatter = {};
    try {
      frontMatter = parse(match[1]) ?? {};
    } catch (error) {
      output.sendDone({
        fail: fail(
          msg,
          error instanceof Error ? error : new Error(String(error)),
        ),
      });
      return;
    }
    const { body: _rawBody, ...rest } = msg;
    output.sendDone({
      out: { ...rest, ...frontMatter, body: msg.body.slice(match[0].length) },
    });
  }
}

export const getComponent = () => new FrontMatter();
