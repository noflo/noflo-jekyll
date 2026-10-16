import { Component, fail } from "@noflo/assembly";

/**
 * Builds the output path and URL for a post message from the site
 * permalink pattern (work document #35: assembly relay for the 1.x
 * BuildPostPath).
 */
export class BuildPostPath extends Component {
  constructor() {
    super({
      description: "Build the output path and URL for a post",
      icon: "file-text-o",
      inPorts: {
        msg: {
          datatype: "object",
          description:
            "Document message with date, name, and categories; carries the site config on config",
          required: true,
        },
        config: {
          datatype: "object",
          description: "Site config with source and permalink",
          required: false,
          control: true,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "The message with path and url set",
        },
        fail: {
          datatype: "object",
          description: "The message with errors accumulated",
        },
      },
    });
  }

  /**
   * @param {string} permalink
   * @param {string[] | undefined} categories
   * @returns {string}
   */
  handleCategories(permalink, categories) {
    const clean = (categories ?? []).filter((category) => category);
    if (clean.length === 0) {
      // No categories: drop the whole segment, collapsing the slash
      return permalink.replace("/:categories", "");
    }
    return permalink.replace(":categories", clean.join("/"));
  }

  /**
   * Zero-pads a date component the way Jekyll's permalink templates do.
   * @param {number} value
   * @param {number} [length]
   * @returns {string}
   */
  pad(value, length = 2) {
    return String(value).padStart(length, "0");
  }

  /**
   * @param {string} permalink
   * @param {Date | undefined} date
   * @returns {string}
   */
  handleDate(permalink, date) {
    if (!date) {
      return permalink;
    }
    return permalink
      .replace(":year", this.pad(date.getFullYear(), 4))
      .replace(":month", this.pad(date.getMonth() + 1))
      .replace(":day", this.pad(date.getDate()));
  }

  /**
   * Jekyll's `:title` is the slug: the source name without its
   * extension. The 1.x implementation kept the extension (the
   * name-with-extension quirk); the Jekyll-generated reference is the
   * contract.
   * @param {string} permalink
   * @param {string} name
   * @returns {string}
   */
  handleTitle(permalink, name) {
    const dot = name.lastIndexOf(".");
    const slug = dot > 0 ? name.slice(0, dot) : name;
    return permalink.replace(":title", slug);
  }

  /**
   * A permalink ending with `/` writes `index.html` into that
   * directory, the way Jekyll stores directory-style URLs.
   * @param {string} permalink
   * @returns {string}
   */
  handleIndex(permalink) {
    if (!permalink.endsWith("/")) {
      return permalink;
    }
    return `${permalink}index.html`;
  }

  /**
   * @param {string} path
   * @param {string} source
   * @returns {string}
   */
  buildUrl(path, source) {
    const url = path.replace(source, "");
    const fileExt = url.includes(".")
      ? url.substring(url.lastIndexOf("."))
      : "";
    const baseName = fileExt ? url.slice(0, url.lastIndexOf(fileExt)) : url;
    const lastSegment = baseName.includes("/")
      ? baseName.slice(baseName.lastIndexOf("/") + 1)
      : baseName;
    if (lastSegment === "index") {
      return `${baseName.slice(0, baseName.lastIndexOf("/"))}/`;
    }
    return url;
  }

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, hasStream(arg: unknown): boolean, attached(port: string): unknown }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output
   */
  forwardBrackets = { msg: ["out", "fail"] };

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output
   */ processMessage(input, output) {
    if (!input.hasData("msg")) {
      return;
    }
    const msg = input.getData("msg");
    const config = input.hasData("config")
      ? input.getData("config")
      : msg.config;
    if (!config?.permalink || !config?.target) {
      output.sendDone({
        fail: fail(
          msg,
          new Error(
            "BuildPostPath requires a config with target and permalink",
          ),
        ),
      });
      return;
    }
    let newpath = `${config.target}${config.permalink}`;
    newpath = this.handleCategories(newpath, msg.categories);
    newpath = this.handleDate(newpath, msg.date);
    newpath = this.handleTitle(newpath, msg.name);
    newpath = this.handleIndex(newpath);
    output.sendDone({
      out: {
        ...msg,
        path: newpath,
        url: this.buildUrl(newpath, config.target),
      },
    });
  }
}

export const getComponent = () => new BuildPostPath();
