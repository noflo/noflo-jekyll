import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

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
  it("builds the fixture site", async () => {
    const { source, target } = fixtureSite();
    await jekyll(source, target);
    // The static copy leg: verbatim passthrough
    const staticPage = readFileSync(join(target, "about.md"), "utf8");
    assert.equal(staticPage, "static about page");
    // The document leg: markdown converted, layout inheritance applied
    const built = readFileSync(join(target, "hello.md"), "utf8");
    assert.match(built, /<article>/);
    assert.match(built, /<h1>Hello world<\/h1>/);
  });
});
