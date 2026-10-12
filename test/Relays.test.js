import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as noflo from "@noflo/noflo";
import { getComponent as getBuildPostPath } from "../components/BuildPostPath.js";
import { getComponent as getPathMetadata } from "../components/PathMetadata.js";
import { getComponent as getPostCollector } from "../components/PostCollector.js";

/**
 * Sends one IP per input port and collects the data values sent to the
 * outport.
 * @param {import("@noflo/noflo").Component} c
 * @param {string} outPort
 * @param {Record<string, any>} inputs
 * @returns {Promise<any>}
 */
const run = async (c, outPort, inputs) => {
  const outSocket = noflo.internalSocket.createSocket();
  c.outPorts[outPort].attach(outSocket);
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for IP")),
      2000,
    );
    outSocket.addEventListener("ip", (/** @type {CustomEvent} */ event) => {
      if (event.detail.type === "data") {
        clearTimeout(timer);
        resolve(event.detail.data);
      }
    });
  });
  for (const [port, value] of Object.entries(inputs)) {
    const socket = noflo.internalSocket.createSocket();
    c.inPorts[port].attach(socket);
    socket.post(new noflo.IP("data", value));
  }
  return received;
};

describe("PathMetadata component", () => {
  it("derives date, name, and categories from a post path", async () => {
    const c = getPathMetadata();
    try {
      const out = await run(c, "out", {
        source: "/site",
        msg: {
          errors: [],
          path: "/site/_posts/2014-03-15-hello-world.md",
          body: "post",
        },
      });
      assert.equal(out.name, "hello-world.md");
      assert.equal(out.categories[0], undefined);
      assert.equal(new Date(out.date).getFullYear(), 2014);
    } finally {
      await c.shutdown();
    }
  });
  it("prefers front-matter category over directories", async () => {
    const c = getPathMetadata();
    try {
      const out = await run(c, "out", {
        source: "/site",
        msg: {
          errors: [],
          path: "/site/_posts/2014-03-15-hello.md",
          category: "announcements",
          date: "2014-05-01",
        },
      });
      assert.deepEqual(out.categories, ["announcements"]);
      assert.equal(new Date(out.date).getMonth(), 4);
      assert.equal(out.name, "hello.md");
    } finally {
      await c.shutdown();
    }
  });
});

describe("BuildPostPath component", () => {
  const config = {
    source: "/site",
    permalink: "/:categories/:year/:month/:day/:title.html",
  };
  it("builds path and url from the permalink pattern", async () => {
    const c = getBuildPostPath();
    try {
      const out = await run(c, "out", {
        config,
        msg: {
          errors: [],
          name: "hello-world.md",
          categories: ["news"],
          date: new Date(2014, 2, 15),
        },
      });
      assert.equal(out.path, "/site/news/2014/3/15/hello-world.md");
      assert.equal(out.url, "/news/2014/3/15/hello-world.md");
    } finally {
      await c.shutdown();
    }
  });
  it("fails the message when config is missing", async () => {
    const c = getBuildPostPath();
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
      const inSocket = noflo.internalSocket.createSocket();
      c.inPorts.msg.attach(inSocket);
      inSocket.post(new noflo.IP("data", { errors: [], name: "x" }));
      const msg = await failed;
      assert.equal(msg.errors.length, 1);
      assert.match(msg.errors[0].message, /source and permalink/);
    } finally {
      await c.shutdown();
    }
  });
});

describe("PostCollector component", () => {
  it("collects posts, sorts them, and builds category maps", async () => {
    const c = getPostCollector();
    try {
      // Collect silently: only the flush produces output
      /** @param {string} port @param {any} value */
  const post = (port, value) => {
        const socket = noflo.internalSocket.createSocket();
        c.inPorts[port].attach(socket);
        socket.post(new noflo.IP("data", value));
      };
      post("config", { source: "/site", permalink: "/:title.html" });
      post("msg", {
        errors: [],
        path: "/site/_posts/2014-01-01-a.md",
        categories: ["news"],
        date: new Date(2014, 0, 1),
        body: "a",
      });
      post("msg", {
        errors: [],
        path: "/site/_posts/2014-06-01-b.md",
        categories: ["news"],
        date: new Date(2014, 5, 1),
        body: "b",
      });
      const flushedPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out")), 2000);
        const outSocket = noflo.internalSocket.createSocket();
        c.outPorts.out.attach(outSocket);
        outSocket.addEventListener("ip", (/** @type {CustomEvent} */ event) => {
          if (event.detail.type === "data") {
            clearTimeout(timer);
            resolve(event.detail.data);
          }
        });
      });
      post("flush", true);
      const flushed = await flushedPromise;
      assert.equal(flushed.posts.length, 2);
      // Newest first
      assert.equal(flushed.posts[0].path, "/site/_posts/2014-06-01-b.md");
      assert.equal(flushed.posts[0].content, "b");
      assert.equal(flushed.categories.news.length, 2);
    } finally {
      await c.shutdown();
    }
  });
});
