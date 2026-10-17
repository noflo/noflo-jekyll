import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as noflo from "@noflo/noflo";

import { getComponent as getDocumentBuilder } from "../components/DocumentBuilder.js";

/**
 * Sends one IP per input port and collects every data value from the
 * outport.
 * @param {import("@noflo/noflo").Component} c
 * @param {string} outPort
 * @param {Record<string, any>} inputs
 * @returns {Promise<any[]>}
 */
const run = async (c, outPort, inputs) => {
  const outSocket = noflo.internalSocket.createSocket();
  /** @type {any[]} */
  const values = [];
  c.outPorts[outPort].attach(outSocket);
  outSocket.addEventListener("ip", (/** @type {CustomEvent} */ event) => {
    if (event.detail.type === "data") {
      values.push(event.detail.data);
    }
  });
  for (const [port, value] of Object.entries(inputs)) {
    const socket = noflo.internalSocket.createSocket();
    c.inPorts[port].attach(socket);
    socket.post(new noflo.IP("data", value));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  return values;
};

/**
 * Sends one IP now and another after a delay, collecting data values
 * from the outport — used to assert order-tolerant buffering: the first
 * arrival must produce nothing, the second resolves the buffered input.
 * @param {import("@noflo/noflo").Component} c
 * @param {string} outPort
 * @param {Array<{ port: string, value: any, delay?: number }>} steps
 * @returns {Promise<any[]>}
 */
const runStaged = async (c, outPort, steps) => {
  const outSocket = noflo.internalSocket.createSocket();
  /** @type {any[]} */
  const values = [];
  c.outPorts[outPort].attach(outSocket);
  outSocket.addEventListener("ip", (/** @type {CustomEvent} */ event) => {
    if (event.detail.type === "data") {
      values.push(event.detail.data);
    }
  });
  for (const step of steps) {
    await new Promise((resolve) => setTimeout(resolve, step.delay ?? 50));
    const socket = noflo.internalSocket.createSocket();
    c.inPorts[step.port].attach(socket);
    socket.post(new noflo.IP("data", step.value));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  return values;
};

const layout = {
  path: "_layouts/post.html",
  body: "<h1>{{ page.title }}</h1>{{ content }}",
};

const post = {
  errors: [],
  path: "/site/_posts/2014-03-15-hello.md",
  body: "post body",
  layout: "post",
  title: "Hello",
};

describe("DocumentBuilder component", () => {
  it("resolves layout inheritance into the template", async () => {
    const c = getDocumentBuilder();
    try {
      const values = await run(c, "out", {
        config: { posts: [], paginate: 2, name: "The Site" },
        templates: layout,
        msg: post,
      });
      assert.equal(values.length, 1);
      assert.equal(values[0].template, "<h1>{{ page.title }}</h1>post body");
      assert.equal(values[0].page.title, "Hello");
      assert.equal(values[0].site.name, "The Site");
    } finally {
      await c.shutdown();
    }
  });
  it("buffers the document until its layout template arrives", async () => {
    const c = getDocumentBuilder();
    try {
      // The document arrives before the template: nothing is emitted,
      // nothing fails — the message stays buffered on the inport
      const values = await runStaged(c, "out", [
        { port: "msg", value: post },
        { port: "templates", value: layout },
        { port: "config", value: { posts: [], paginate: 2 } },
      ]);
      assert.equal(values.length, 1);
      assert.equal(values[0].template, "<h1>{{ page.title }}</h1>post body");
    } finally {
      await c.shutdown();
    }
  });
  it("buffers the document until the site config arrives", async () => {
    const c = getDocumentBuilder();
    try {
      // Posts-referencing body with no config yet: held, not failed
      const values = await runStaged(c, "out", [
        {
          port: "msg",
          value: {
            errors: [],
            path: "/site/index.html",
            body: "{{ site.posts }}",
          },
        },
        { port: "config", value: { posts: [], paginate: 2 } },
      ]);
      assert.equal(values.length, 1);
      assert.equal(values[0].template, "{{ site.posts }}");
    } finally {
      await c.shutdown();
    }
  });
  it("keeps a document whose layout never arrives buffered without failing", async () => {
    const c = getDocumentBuilder();
    const failSocket = noflo.internalSocket.createSocket();
    /** @type {any[]} */
    const failed = [];
    c.outPorts.fail.attach(failSocket);
    failSocket.addEventListener("ip", (/** @type {CustomEvent} */ event) => {
      if (event.detail.type === "data") {
        failed.push(event.detail.data);
      }
    });
    const outSocket = noflo.internalSocket.createSocket();
    /** @type {any[]} */
    const out = [];
    c.outPorts.out.attach(outSocket);
    outSocket.addEventListener("ip", (/** @type {CustomEvent} */ event) => {
      if (event.detail.type === "data") {
        out.push(event.detail.data);
      }
    });
    try {
      const socket = noflo.internalSocket.createSocket();
      c.inPorts.config.attach(socket);
      socket.post(new noflo.IP("data", { posts: [], paginate: 2 }));
      const inSocket = noflo.internalSocket.createSocket();
      c.inPorts.msg.attach(inSocket);
      inSocket.post(
        new noflo.IP("data", {
          errors: [],
          path: "/site/_posts/2014-03-15-hello.md",
          body: "post body",
          layout: "nosuch",
        }),
      );
      // A missing part is "not yet", never "never": nothing is emitted
      // and nothing fails within the wait window
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(out.length, 0);
      assert.equal(failed.length, 0);
    } finally {
      await c.shutdown();
    }
  });
  it("expands paginated documents into one message per page", async () => {
    const c = getDocumentBuilder();
    const config = {
      posts: [
        {
          path: "/site/_posts/2014-01-01-a.md",
          title: "A",
          content: "<p>A</p>",
        },
        {
          path: "/site/_posts/2014-02-01-b.md",
          title: "B",
          content: "<p>B</p>",
        },
        {
          path: "/site/_posts/2014-03-01-c.md",
          title: "C",
          content: "<p>C</p>",
        },
      ],
      paginate: 2,
      target: "/site",
    };
    try {
      const values = await run(c, "out", {
        config,
        msg: {
          errors: [],
          path: "/site/index.html",
          body: "{% for post in paginator.posts %}{{ post.title }}{% endfor %}",
        },
      });
      assert.equal(values.length, 2);
      assert.equal(values[0].paginator.page, 1);
      assert.equal(values[0].paginator.posts.length, 2);
      assert.equal(values[0].paginator.total_pages, 2);
      assert.equal(values[0].paginator.previous_page_path, null);
      assert.equal(values[1].path, "/site/page2/index.html");
      assert.equal(values[1].paginator.posts.length, 1);
      // Page 1 of the paginated document is the document itself, at its
      // own URL — the Jekyll page URL convention (the site root's
      // index.html maps to "/")
      assert.equal(values[1].paginator.previous_page_path, "/");
      assert.equal(values[1].paginator.next_page_path, null);
    } finally {
      await c.shutdown();
    }
  });
});
