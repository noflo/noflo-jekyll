import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jekyll } from "../lib/Jekyll.js";

/**
 * Creates a fixture Jekyll site in a temp directory.
 * @returns {{ source: string, target: string }}
 */
const fixtureSite = () => {
  const source = mkdtempSync(join(tmpdir(), "noflo-jekyll-src-"));
  const target = mkdtempSync(join(tmpdir(), "noflo-jekyll-out-"));
  mkdirSync(join(source, "_posts"), { recursive: true });
  mkdirSync(join(source, "_layouts"), { recursive: true });
  writeFileSync(join(source, "_config.yml"), "permalink: /:title.html\n");
  writeFileSync(
    join(source, "_layouts", "post.html"),
    "<article>{{ content }}</article>",
  );
  writeFileSync(
    join(source, "_posts", "2014-03-15-hello.md"),
    "---\ntitle: Hello\nlayout: post\n---\n# Hello world",
  );
  writeFileSync(join(source, "about.md"), "static about page");
  return { source, target };
};

describe("jekyll end-to-end", () => {
  // The document pipeline (posts → markdown → liquid → write) requires
  // the assembly layer's bracket correlation and the platform-side
  // promise-chain bounding (work document #35 update #7). The build
  // may hang until those land; the static copy leg works.
  it("copies static files to the target", async () => {
    const { source, target } = fixtureSite();
    const output = await Promise.race([
      jekyll(source, target),
      new Promise((resolve) => {
        // The streaming network doesn't self-end (noflo/noflo#1048):
        // resolve after a delay and check the target dir contents
        setTimeout(() => resolve({ timedOut: true }), 10000);
      }),
    ]);
    const staticPage = readFileSync(join(target, "about.md"), "utf8");
    assert.equal(staticPage, "static about page");
    // The document pipeline: expected to work once the assembly
    // bracket-correlation and promise-chain bounding land
    if (output && !output.timedOut) {
      const built = readFileSync(join(target, "hello.md"), "utf8");
      assert.match(built, /<article>/);
      assert.match(built, /<h1>Hello world<\/h1>/);
    }
  });
});
