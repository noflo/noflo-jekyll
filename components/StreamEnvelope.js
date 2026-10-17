import { Component as AssemblyComponent } from "@noflo/assembly";
import { Component, IP } from "@noflo/noflo";

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
 * collector. This is the component-level form of the EOT-to-packet
 * terminator convention (work documents #40 update #10 and #47 §8): EOT
 * itself does not fire a process, so a completion signal that must be
 * observable by downstream gating rides as a bracket instead.
 *
 * The activation contract: one holder activation consumes and forwards
 * everything until the input reaches EOT, then closes the frame — a
 * single long-lived activation, the sanctioned deferred-completion
 * pattern (the promise resolution is the completion). Later arrivals
 * fire activations that decline at the has-level and leave their
 * packets for the holder, so no two activations can interleave their
 * forwards and the frame close can never race a forward.
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
    /** @type {boolean} */
    this.draining = false;
  }

  forwardBrackets = { msg: [] };

  tearDown() {
    this.draining = false;
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
   * @param {{ hasData(...args: unknown[]): boolean, getData(...args: unknown[]): any, ports: { msg: { isEot(): boolean, addEventListener(type: string, listener: () => void, options?: { once: boolean }): void, removeEventListener(type: string, listener: () => void): void } } }} input
   * @param {{ send(map: Record<string, unknown>): Promise<void>, done(err?: Error): void }} output
   * @returns {Promise<void>}
   */
  async processMessage(input, output) {
    if (this.draining) {
      // The holder activation owns the stream; this arrival's packet is
      // consumed by the holder's next loop iteration
      return;
    }
    this.draining = true;
    try {
      /** @type {boolean} */
      let opened = false;
      while (true) {
        while (input.hasData("msg")) {
          const packet = input.getData("msg");
          if (!opened) {
            opened = true;
            await output.send({
              out: new IP("openBracket", "collection"),
            });
          }
          await output.send({ out: packet });
        }
        if (input.ports.msg.isEot()) {
          break;
        }
        await this.waitForProgress(input);
      }
      if (opened) {
        await output.send({ out: new IP("closeBracket", "collection") });
      }
    } finally {
      this.draining = false;
    }
  }
}

export const getComponent = () => new StreamEnvelope();
