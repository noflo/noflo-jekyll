import { Component as AssemblyComponent } from "@noflo/assembly";
import { IP } from "@noflo/noflo";

/**
 * Merges a multi-source packet stream into one outer-framed stream.
 *
 * The posts leg of the build pipeline fans in several bracketed directory
 * listings (the root `_posts` listing and one per discovered nested
 * `_posts` directory) into a single connection. The stream-level
 * collector gates on bracket-stream completeness, and one source group
 * completing is not "the collection is complete" — a later listing may
 * still be in flight, so flushing on the first completed group bakes an
 * incomplete collection into every listing and pagination page.
 *
 * The relay terminates the incoming framing (`forwardBrackets = { msg:
 * [] }` — the per-listing brackets are consumed at arrival, the
 * component reads pure data) and emits one flat outer frame of its own:
 * it opens the frame before the first data IP and closes it when the
 * input reaches EOT. The close is the stream's completion moment — and
 * under the one-firing rule it is also the firing that wakes the
 * collector. The forwards also strip the packets' scopes: the frame is
 * the completion mechanism for a single-scope downstream consumer (a
 * stream-level collector), and scoped packets would partition its input
 * into per-scope streams — one flush per message instead of one flush
 * over the collection. This is the component-level form of the
 * EOT-to-packet terminator convention (work documents #40 update #10
 * and #47 §8): EOT itself does not fire a process, so a completion
 * signal that must be observable by downstream gating rides as a
 * bracket instead.
 *
 * The activation contract: the holder is per scope — messages carry
 * per-message scopes (the wrapped upstreams correlate per scope), and
 * an activation can read only its own scope's partition, so every
 * scope's activation drains its own packets inside the one shared
 * frame while it waits for its port's next arrival or terminal close
 * (the sanctioned deferred-completion pattern — the promise resolution
 * is the completion). A same-scope arrival during its holder's drain
 * declines at the has-level and its packet is picked up by the
 * holder's re-checks. The frame's open and close are global: the open
 * rides the first forward; the close rides the first activation to
 * observe the input's EOT, guarded so it sends exactly once. Every
 * forward is queued before its activation's EOT wait begins, and the
 * close's EOT resolution happens after all packets delivered, so the
 * close can never race a forward.
 */
export class StreamEnvelope extends AssemblyComponent {
  constructor() {
    super({
      description: "Wrap a multi-source stream in one outer bracket frame",
      icon: "ellipsis-v",
      inPorts: {
        msg: {
          datatype: "all",
          description: "The merged multi-source packet stream",
          required: true,
        },
      },
      outPorts: {
        out: {
          datatype: "all",
          description: "The stream wrapped in one outer bracket frame",
        },
      },
    });
    /**
     * The scopes with a holder in flight: each activation reads only
     * its own scope's partition, and every scope's holder drains its
     * own packets inside the one shared frame
     *
     * @type {Set<string | null>}
     */
    this.drainingScopes = new Set();
    /** @type {boolean} */
    this.opened = false;
    /** @type {boolean} */
    this.ended = false;
  }

  forwardBrackets = { msg: [] };

  tearDown() {
    this.drainingScopes.clear();
    this.opened = false;
    this.ended = false;
    return Promise.resolve();
  }

  /**
   * Resolves on the port's next arrival or terminal close, whichever
   * comes first: the holder loop re-checks both its buffer and EOT.
   * @param {{ ports: { msg: { isEot(): boolean, addEventListener(type: string, listener: () => void, options?: { once: boolean }): void, removeEventListener(type: string, listener: () => void): void } } }} input
   * @returns {Promise<void>}
   */
  waitForProgress(input) {
    return new Promise((resolve) => {
      const done = () => {
        input.ports.msg.removeEventListener("ip", done);
        input.ports.msg.removeEventListener("disconnect", done);
        resolve();
      };
      input.ports.msg.addEventListener("ip", done);
      input.ports.msg.addEventListener("disconnect", done);
    });
  }

  /**
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, scope: string | null, ports: { msg: { isEot(): boolean, addEventListener(type: string, listener: () => void, options?: { once: boolean }): void, removeEventListener(type: string, listener: () => void): void } } }} input
   * @param {{ send(map: Record<string, unknown>): Promise<void>, done(err?: Error): void }} output
   * @returns {Promise<void>}
   */
  async processMessage(input, output) {
    const scope = input.scope ?? null;
    if (this.drainingScopes.has(scope)) {
      // This scope's holder owns its partition; the arrival's packet is
      // consumed by the holder's next loop iteration
      return;
    }
    this.drainingScopes.add(scope);
    try {
      while (true) {
        while (input.hasData("msg")) {
          const packet = input.getData("msg");
          if (!this.opened) {
            this.opened = true;
            await output.send({
              out: new IP("openBracket", "collection"),
            });
          }
          // The scope is stripped with the framing: the frame is the
          // completion mechanism for a single-scope downstream consumer
          await output.send({ out: new IP("data", packet) });
        }
        if (input.ports.msg.isEot()) {
          break;
        }
        await this.waitForProgress(input);
      }
    } finally {
      this.drainingScopes.delete(scope);
    }
    // The frame closes on the first activation to observe the input's
    // EOT — every forward was queued before its holder's EOT wait
    // began, and the EOT arrives after all packets delivered, so the
    // close can never race a forward
    if (this.opened && !this.ended) {
      this.ended = true;
      await output.send({ out: new IP("closeBracket", "collection") });
    }
  }
}

export const getComponent = () => new StreamEnvelope();
