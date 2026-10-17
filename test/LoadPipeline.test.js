import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as noflo from "@noflo/noflo";
import { getComponent as getFrontMatter } from "../components/FrontMatter.js";
import { getComponent as getLoadDocument } from "../components/LoadDocument.js";

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
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), 2000);
    outSocket.addEventListener("ip", (/** @type {CustomEvent} */ event) => {
      if (event.detail.type === "data") {
        clearTimeout(timer);
        resolve(event.detail.data);
      }
    });
  });
  c.outPorts[outPort].attach(outSocket);
  for (const [port, value] of Object.entries(inputs)) {
    const socket = noflo.internalSocket.createSocket();
    c.inPorts[port].attach(socket);
    socket.post(new noflo.IP("data", value));
  }
  return received;
};

const SITE = mkdtempSync(join(tmpdir(), "noflo-jekyll-"));
mkdirSync(join(SITE, "_posts"), { recursive: true });

describe("LoadDocument component", () => {
  it("reads a source file into a document message", async () => {
    const c = getLoadDocument();
    const post = join(SITE, "_posts", "2014-03-15-hello.md");
    writeFileSync(post, "---\ntitle: Hello\n---\npost body");
    try {
      const out = await run(c, "out", {
        source: SITE,
        path: post,
      });
      assert.equal(out.path, post);
      assert.equal(out.source, SITE);
      assert.match(out.body, /post body/);
    } finally {
      await c.shutdown();
    }
  });
  it("fails with the path message when the file is missing", async () => {
    const c = getLoadDocument();
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
      const socket = noflo.internalSocket.createSocket();
      c.inPorts.path.attach(socket);
      socket.post(new noflo.IP("data", join(SITE, "nosuch.md")));
      const msg = await failed;
      assert.equal(msg.path, join(SITE, "nosuch.md"));
      assert.ok(
        msg.errors.some((/** @type {Error} */ e) =>
          /no such file/i.test(e.message),
        ),
      );
    } finally {
      await c.shutdown();
    }
  });
});

describe("FrontMatter component", () => {
  it("splits front matter into message fields and trims the body", async () => {
    const c = getFrontMatter();
    try {
      const out = await run(c, "out", {
        msg: {
          errors: [],
          path: "/site/_posts/2014-03-15-hello.md",
          body: "---\ntitle: Hello\ncategory: news\n---\npost body",
        },
      });
      assert.equal(out.title, "Hello");
      assert.equal(out.category, "news");
      assert.equal(out.body, "post body");
    } finally {
      await c.shutdown();
    }
  });
  it("passes bodies without front matter through untouched", async () => {
    const c = getFrontMatter();
    try {
      const out = await run(c, "out", {
        msg: { errors: [], path: "/site/about.md", body: "plain body" },
      });
      assert.equal(out.body, "plain body");
      assert.equal(out.title, undefined);
    } finally {
      await c.shutdown();
    }
  });
  it("fails on invalid front matter YAML", async () => {
    const c = getFrontMatter();
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
      const socket = noflo.internalSocket.createSocket();
      c.inPorts.msg.attach(socket);
      socket.post(
        new noflo.IP("data", {
          errors: [],
          path: "/site/_posts/broken.md",
          body: "---\ntitle: [unclosed\n---\nbody",
        }),
      );
      const msg = await failed;
      assert.ok(msg.errors.length > 0);
    } finally {
      await c.shutdown();
    }
  });
});
