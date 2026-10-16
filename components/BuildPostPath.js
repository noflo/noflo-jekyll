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
    if (!categories) {
      return permalink.replace("/:categories", "");
    }
    const clean = categories.filter((category) => category);
    return permalink.replace(":categories", clean.join("/"));
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
      .replace(":year", String(date.getFullYear()))
      .replace(":month", String(date.getMonth() + 1))
      .replace(":day", String(date.getDate()));
  }

  /**
   * @param {string} permalink
   * @param {string} name
   * @returns {string}
   */
  handleTitle(permalink, name) {
    const permaExt = permalink.substring(permalink.lastIndexOf("."));
    const nameExt = name.includes(".")
      ? name.substring(name.lastIndexOf("."))
      : "";
    const endSlash = permalink.endsWith("/");

    if (permaExt !== nameExt) {
      // Remove the permalink extension
      const dirName = permalink.slice(
        0,
        Math.max(permalink.lastIndexOf("/"), 0),
      );
      const baseName = permaExt
        ? permalink.slice(
            permalink.lastIndexOf("/") + 1,
            permalink.lastIndexOf(permaExt),
          )
        : permalink.slice(permalink.lastIndexOf("/") + 1);
      permalink = `${dirName}/${baseName}`;
      if (endSlash && !permalink.endsWith("/")) {
        permalink = `${permalink}/`;
      }
    }
    return permalink.replace(":title", name);
  }

  /**
   * @param {string} permalink
   * @returns {string}
   */
  handleIndex(permalink) {
    if (!permalink.endsWith("/")) {
      return permalink;
    }
    const filePath = permalink.slice(0, -1);
    const permaExt = filePath.includes(".")
      ? filePath.substring(filePath.lastIndexOf("."))
      : "";
    const dirName = filePath.slice(0, Math.max(filePath.lastIndexOf("/"), 0));
    const baseName = permaExt
      ? filePath.slice(
          filePath.lastIndexOf("/") + 1,
          filePath.lastIndexOf(permaExt),
        )
      : filePath.slice(filePath.lastIndexOf("/") + 1);
    return `${dirName}/${baseName}/index${permaExt}`;
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
