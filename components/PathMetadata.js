import { Component } from "@noflo/assembly";

// Post filename pattern: YYYY-MM-DD-name.ext
const pathMatcher = /^(\d{4})-0?(\d+)-0?(\d+)-([A-Za-z0-9-_.]*)(\.[^.]+)?$/;

/**
 * Enriches a document message with post metadata: `date`, `name`, and
 * `categories`, derived from the document front matter and the source
 * path (work document #35: assembly relay for the 1.x PathMetadata).
 */
export class PathMetadata extends Component {
  constructor() {
    super({
      description: "Add post metadata to a document message",
      icon: "file-text-o",
      inPorts: {
        msg: {
          datatype: "object",
          description:
            "Document message with a path; optional date, name, category, or categories fields",
          required: true,
        },
        source: {
          datatype: "string",
          description: "Site source directory",
          required: false,
          control: true,
          // Standing configuration: the unscoped source IIP must stay
          // readable from the documents' scoped activations
          scoped: false,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "The message with date, name, and categories added",
        },
      },
    });
  }

  /**
   * @param {{ path: string }} post
   * @param {Record<string, unknown>} data
   * @returns {Date}
   */
  getDate(post, data) {
    if (data.date) {
      // Parse the ISO date
      return new Date(/** @type {any} */ (data.date));
    }
    const match = pathMatcher.exec(
      post.path.slice(post.path.lastIndexOf("/") + 1),
    );
    if (!match) {
      return new Date();
    }
    return new Date(`${match[1]}-${match[2]}-${match[3]}`);
  }

  /**
   * @param {string} postPath
   * @returns {string}
   */
  getName(postPath) {
    const postName = postPath.slice(postPath.lastIndexOf("/") + 1);
    const match = pathMatcher.exec(postName);
    // TODO: use Stringex for generating URL names in cases where we
    // can't parse one
    if (!match) {
      return "";
    }
    return match[4];
  }

  /**
   * @param {Record<string, any>} data
   * @param {string} source
   * @returns {string[]}
   */
  getCategories(data, source) {
    if (data.category) {
      return [data.category];
    }
    if (data.categories) {
      return data.categories;
    }
    const postPath = data.path.replace(source, "");
    const dirName = postPath.substring(0, postPath.lastIndexOf("/"));
    const dirs = dirName.split("/");
    /** @type {string[]} */
    const categories = [];
    for (const dir of dirs) {
      if (!dir || dir === "_posts") {
        continue;
      }
      categories.push(dir);
    }
    return categories;
  }

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, hasStream(arg: unknown): boolean, attached(port: string): unknown }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output
   */
  forwardBrackets = { msg: ["out"] };

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output
   */ processMessage(input, output) {
    if (!input.hasData("msg")) {
      return;
    }
    const msg = input.getData("msg");
    if (this.validate(msg)) {
      const source = input.hasData("source") ? input.getData("source") : "";
      const enriched = {
        ...msg,
        date: this.getDate({ path: msg.path }, msg),
        name: this.getName(msg.path),
        categories: this.getCategories({ ...msg, path: msg.path }, source),
      };
      output.sendDone({ out: enriched });
      return;
    }
    output.sendDone({ out: msg });
  }
}

export const getComponent = () => new PathMetadata();
