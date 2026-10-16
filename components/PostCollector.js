import { Component } from "@noflo/assembly";

/**
 * Builds the site collection from the bracketed posts stream: the scan
 * subgraph emits each post as a message inside a bracketed substream,
 * and the collector fires when the stream completes (work document #35:
 * the 1.x disconnect-flush becomes the 2.x collect-until-bracket-close
 * pattern). Stateless — the whole collection lives in the stream.
 */
export class PostCollector extends Component {
  constructor() {
    super({
      description: "Build the site collection from the posts stream",
      icon: "sort-amount-desc",
      inPorts: {
        msg: {
          datatype: "object",
          description: "Bracketed stream of document messages",
          required: true,
        },
        config: {
          datatype: "object",
          description: "Site config read non-consumingly",
          required: false,
          control: true,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "The config with sorted posts and categories",
        },
      },
    });
  }

  /**
   * @param {Record<string, any>} post
   * @returns {Record<string, any>}
   */
  processPost(post) {
    return { ...post, content: post.body };
  }

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, hasStream(arg: unknown): boolean, getStream(arg: unknown): import("@noflo/noflo").IP[], attached(port: string): unknown }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output
   * @returns {void}
   */
  processMessage(input, output) {
    if (!input.hasStream("msg")) {
      return;
    }
    // The config is a control port: the read is non-consuming, so the
    // buffered IP is available on every activation
    const config = input.hasData("config")
      ? { ...input.getData("config") }
      : undefined;
    if (!config) {
      output.done(
        new Error(
          "PostCollector requires the site config before the posts stream",
        ),
      );
      return;
    }
    const stream = /** @type {import("@noflo/noflo").IP[]} */ (
      input.getStream("msg")
    );
    /** @type {Record<string, any>[]} */
    const posts = [];
    /** @type {Record<string, Record<string, any>[]>} */
    const categories = {};
    for (const packet of stream) {
      if (packet.type !== "data") {
        continue;
      }
      const post = this.processPost(packet.data);
      posts.push(post);
      for (const category of post.categories ?? []) {
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(post);
      }
    }
    posts.sort((a, b) => {
      if (a.date === b.date) {
        const pathA = a.path.toLowerCase();
        const pathB = b.path.toLowerCase();
        if (pathA === pathB) {
          return 0;
        }
        return pathA < pathB ? -1 : 1;
      }
      return a.date < b.date ? 1 : -1;
    });
    for (const name of Object.keys(categories)) {
      categories[name].sort((a, b) => (a.date < b.date ? 1 : -1));
    }
    config.posts = posts;
    config.categories = categories;
    output.sendDone({ out: config });
  }
}

export const getComponent = () => new PostCollector();
