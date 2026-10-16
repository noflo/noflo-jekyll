import { Component } from "@noflo/assembly";

/**
 * Expands the flushed site config into one message per post, carrying
 * the config for pagination (work document #35: the phase-2 head of the
 * build pipeline — posts are processed for output only after the whole
 * collection is known).
 */
export class ExpandPosts extends Component {
  constructor() {
    super({
      description: "Expand the flushed site config into per-post messages",
      icon: "clone",
      inPorts: {
        msg: {
          datatype: "object",
          description: "The flushed config with posts and categories",
          required: true,
        },
      },
      outPorts: {
        out: {
          datatype: "object",
          description: "One message per post, with the site config attached",
        },
        config: {
          datatype: "object",
          description: "The flushed config itself",
        },
      },
    });
  }

  /** @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any }} input @param {{ sendDone(map: Record<string, unknown>): void, send(map: Record<string, unknown>): void, done(err?: Error): void }} output */
  processMessage(input, output) {
    if (!input.hasData("msg")) {
      return;
    }
    const config = input.getData("msg");
    output.send({ config });
    for (const post of config.posts ?? []) {
      output.send({ out: { ...post, config } });
    }
    output.done();
  }
}

export const getComponent = () => new ExpandPosts();
