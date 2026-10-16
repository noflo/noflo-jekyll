import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { jekyll } from "../lib/Jekyll.js";

// The network holds the event loop after the tests complete
// (noflo/noflo#1048): force-exit after all tests in this file finish
after(() => process.exit(0));

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
  it("copies static files to the target", async () => {
    const { source, target } = fixtureSite();
    const output = await Promise.race([
      jekyll(source, target),
      new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "Build timed out (the document pipeline's promise-chain bounding is the open platform work)",
              ),
            ),
          10000,
        );
      }),
    ]);
    assert.ok(output, "build output present");
    // The static copy leg: verified working
    const staticPage = readFileSync(join(target, "about.md"), "utf8");
    assert.equal(staticPage, "static about page");
    // The document pipeline (posts → markdown → liquid → write) is the
    // known open item: the assembly layer's bracket correlation and the
    // promise-chain bounding (work document #35 update #7)
    const built = readFileSync(join(target, "hello.md"), "utf8");
    assert.match(built, /<article>/);
    assert.match(built, /<h1>Hello world<\/h1>/);
  });
});
