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
    target: "/out",
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
      assert.equal(out.path, "/out/news/2014/3/15/hello-world.md");
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
      assert.match(msg.errors[0].message, /target and permalink/);
    } finally {
      await c.shutdown();
    }
  });
});

describe("PostCollector component", () => {
  /**
   * Sends a bracketed posts stream plus the config, returns the emitted config.
   * @param {import("@noflo/noflo").Component} c
   * @param {Array<Record<string, any>>} posts
   * @returns {Promise<any>}
   */
  const runStream = async (c, posts) => {
    const outSocket = noflo.internalSocket.createSocket();
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out")), 2000);
      outSocket.addEventListener("ip", (/** @type {CustomEvent} */ event) => {
        if (event.detail.type === "data") {
          clearTimeout(timer);
          resolve(event.detail.data);
        }
      });
    });
    c.outPorts.out.attach(outSocket);
    const configSocket = noflo.internalSocket.createSocket();
    c.inPorts.config.attach(configSocket);
    configSocket.post(
      new noflo.IP("data", { source: "/site", permalink: "/:title.html" }),
    );
    const msgSocket = noflo.internalSocket.createSocket();
    c.inPorts.msg.attach(msgSocket);
    msgSocket.post(new noflo.IP("openBracket", "posts"));
    for (const post of posts) {
      msgSocket.post(new noflo.IP("data", post));
    }
    msgSocket.post(new noflo.IP("closeBracket", "posts"));
    return received;
  };

  it("builds the collection from the bracketed posts stream", async () => {
    const c = getPostCollector();
    try {
      const config = await runStream(c, [
        {
          errors: [],
          path: "/site/_posts/2014-01-01-a.md",
          categories: ["news"],
          date: new Date(2014, 0, 1),
          body: "a",
        },
        {
          errors: [],
          path: "/site/_posts/2014-06-01-b.md",
          categories: ["news"],
          date: new Date(2014, 5, 1),
          body: "b",
        },
        {
          errors: [],
          path: "/site/_posts/2014-03-01-c.md",
          date: new Date(2014, 2, 1),
          body: "c",
        },
      ]);
      assert.equal(config.posts.length, 3);
      // Newest first
      assert.equal(config.posts[0].path, "/site/_posts/2014-06-01-b.md");
      assert.equal(config.posts[0].content, "b");
      assert.equal(config.categories.news.length, 2);
      assert.equal(
        config.categories.news[0].path,
        "/site/_posts/2014-06-01-b.md",
      );
    } finally {
      await c.shutdown();
    }
  });
  it("is stateless: a second stream produces a fresh collection", async () => {
    const c = getPostCollector();
    try {
      await runStream(c, [
        {
          errors: [],
          path: "/site/_posts/2014-01-01-old.md",
          date: new Date(2014, 0, 1),
          body: "old",
        },
      ]);
      const config = await runStream(c, [
        {
          errors: [],
          path: "/site/_posts/2015-01-01-new.md",
          date: new Date(2015, 0, 1),
          body: "new",
        },
      ]);
      assert.equal(config.posts.length, 1);
      assert.equal(config.posts[0].path, "/site/_posts/2015-01-01-new.md");
    } finally {
      await c.shutdown();
    }
  });
});
