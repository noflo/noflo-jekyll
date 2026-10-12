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

const layout = {
  path: "_layouts/post.html",
  body: "<h1>{{ page.title }}</h1>{{ content }}",
};

describe("DocumentBuilder component", () => {
  it("resolves layout inheritance into the template", async () => {
    const c = getDocumentBuilder();
    try {
      const values = await run(c, "out", {
        config: { posts: [], paginate: 2 },
        templates: layout,
        msg: {
          errors: [],
          path: "/site/_posts/2014-03-15-hello.md",
          body: "post body",
          layout: "post",
          title: "Hello",
        },
      });
      assert.equal(values.length, 1);
      assert.equal(values[0].template, "<h1>{{ page.title }}</h1>post body");
      assert.equal(values[0].variables.title, "Hello");
    } finally {
      await c.shutdown();
    }
  });
  it("fails the message when the layout is missing", async () => {
    const c = getDocumentBuilder();
    const failSocket = noflo.internalSocket.createSocket();
    c.outPorts.fail.attach(failSocket);
    try {
      const failed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out")), 2000);
        failSocket.addEventListener(
          "ip",
          (/** @type {CustomEvent} */ event) => {
            if (event.detail.type === "data") {
              clearTimeout(timer);
              resolve(event.detail.data);
            }
          },
        );
      });
      // The config must arrive (control port) before the documents
      const configSocket = noflo.internalSocket.createSocket();
      c.inPorts.config.attach(configSocket);
      configSocket.post(new noflo.IP("data", { posts: [], paginate: 2 }));
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
      const msg = await failed;
      assert.equal(msg.errors.length, 1);
      assert.match(msg.errors[0].message, /Template nosuch not found/);
    } finally {
      await c.shutdown();
    }
  });
  it("expands paginated documents into one message per page", async () => {
    const c = getDocumentBuilder();
    const config = {
      posts: [
        { path: "/site/_posts/2014-01-01-a.md", title: "A" },
        { path: "/site/_posts/2014-02-01-b.md", title: "B" },
        { path: "/site/_posts/2014-03-01-c.md", title: "C" },
      ],
      paginate: 2,
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
      assert.equal(values[1].paginator.previous_page_path, "/index.html");
      assert.equal(values[1].paginator.next_page_path, null);
    } finally {
      await c.shutdown();
    }
  });
  it("fails when the body references posts before they are available", async () => {
    const c = getDocumentBuilder();
    const failSocket = noflo.internalSocket.createSocket();
    c.outPorts.fail.attach(failSocket);
    try {
      // No config arrival: posts unavailable
      const failed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out")), 2000);
        failSocket.addEventListener(
          "ip",
          (/** @type {CustomEvent} */ event) => {
            if (event.detail.type === "data") {
              clearTimeout(timer);
              resolve(event.detail.data);
            }
          },
        );
      });
      const inSocket = noflo.internalSocket.createSocket();
      c.inPorts.msg.attach(inSocket);
      inSocket.post(
        new noflo.IP("data", {
          errors: [],
          path: "/site/index.html",
          body: "{{ site.posts }}",
        }),
      );
      const msg = await failed;
      assert.ok(
        msg.errors.some((/** @type {Error} */ e) => /posts/.test(e.message)),
      );
    } finally {
      await c.shutdown();
    }
  });
});
