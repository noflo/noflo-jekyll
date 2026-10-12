import { Component } from "@noflo/assembly";

/**
 * Sorts posts newest-first; same-date posts break the tie by path.
 * @param {Record<string, any>} post1
 * @param {Record<string, any>} post2
 * @returns {number}
 */
const sortByDate = (post1, post2) => {
  if (post1.date === post2.date) {
    const path1 = post1.path.toLowerCase();
    const path2 = post2.path.toLowerCase();
    if (path1 === path2) {
      return 0;
    }
    return path1 < path2 ? -1 : 1;
  }
  return post1.date < post2.date ? 1 : -1;
};

/**
 * Collects document messages into the site config: sorted `posts` and a
 * `categories` map. The 1.x component flushed on connection disconnect;
 * the assembly relay flushes on a `flush` bang, which the graph wires
 * from the end-of-sources signal.
 */
export class PostCollector extends Component {
  constructor() {
    super({
      description: "Collect posts into the site config",
      icon: "sort-amount-desc",
      inPorts: {
        msg: {
          datatype: "object",
          description: "Document message to collect",
          required: false,
        },
        config: {
          datatype: "object",
          description:
            "Site config; posts and categories are initialized on arrival",
          required: false,
          control: true,
        },
        flush: {
          datatype: "bang",
          description: "Sort and emit the collected config",
          required: false,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "The config with sorted posts and categories",
        },
      },
    });
    /** @type {Record<string, any>[]} */
    this.posts = [];
    /** @type {Record<string, Record<string, any>[]>} */
    this.categories = {};
    this.config = null;
    this.initialized = false;
  }

  tearDown() {
    this.posts = [];
    this.categories = {};
    this.config = null;
    this.initialized = false;
    return Promise.resolve();
  }

  /**
   * @param {Record<string, any>} post
   * @returns {void}
   */
  processPost(post) {
    this.posts.push({ ...post, content: post.body });
    if (!post.categories) {
      return;
    }
    for (const category of post.categories) {
      if (!this.categories[category]) {
        this.categories[category] = [];
      }
      this.categories[category].push({ ...post, content: post.body });
    }
  }

  /**
   * @returns {Record<string, any>}
   */
  flush() {
    const config = { ...this.config, posts: [...this.posts].sort(sortByDate) };
    config.categories = config.categories ?? {};
    for (const [name, category] of Object.entries(this.categories)) {
      config.categories[name] = [...category].sort(sortByDate);
    }
    return config;
  }

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, hasStream(arg: unknown): boolean, attached(port: string): unknown }} input
   * @param {{ sendDone(map: Record<string, unknown>): void, done(err?: Error): void }} output
   */
  processMessage(input, output) {
    // The config is a control port: hasData stays true while the IP is
    // buffered, so the initialization must run only once (a new config
    // IP replaces the buffered one but the collector treats the first
    // as authoritative; tearDown resets for component reuse)
    if (input.hasData("config") && !this.initialized) {
      this.initialized = true;
      this.config = { ...input.getData("config") };
      this.config.posts = [];
      this.categories = {};
    }
    if (input.hasData("msg")) {
      this.processPost(input.getData("msg"));
    }
    if (input.hasData("flush")) {
      if (!this.initialized) {
        output.done(
          new Error("PostCollector requires a config before flushing"),
        );
        return;
      }
      input.getData("flush");
      output.sendDone({ out: this.flush() });
      return;
    }
    output.done();
  }
}

export const getComponent = () => new PostCollector();
