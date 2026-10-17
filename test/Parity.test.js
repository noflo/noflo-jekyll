import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { describe, it } from "node:test";

import { assembleTraceFileFromRecorder } from "@noflo/fbp-protocol";
import { Flowtrace } from "@noflo/noflo";

import { jekyll } from "../lib/Jekyll.js";

/**
 * End-to-end parity against the Jekyll-generated reference: the fixture
 * site in `fixtures/source` is built with a real Jekyll (3.9, the
 * reference committed under `fixtures/jekyll`) and with noflo-jekyll,
 * and the trees are compared.
 *
 * Text files compare with blank lines collapsed — the fixture's
 * markdown engine (rdiscount) formats paragraphs with blank lines while
 * the commonmark reference parser emits compact output; that engine
 * difference is the one documented deviation, everything else is byte
 * parity. Binary assets compare bytewise.
 *
 * Known gaps are NOT whitelisted into green: each is a visible `todo`
 * below (the affected files are excluded from the strict walk), so the
 * runner reports them on every run and the strict test fails the
 * moment an unexpected deviation appears. When a gap closes, its todo
 * turns into a passing comparison and its exclusion goes.
 */
const source = join(import.meta.dirname, "fixtures", "source");
const reference = join(import.meta.dirname, "fixtures", "jekyll");

/**
 * The known gap: files whose build output depends on the nested
 * `_posts` discovery (baz/_posts) that is not implemented yet. The
 * nested post shifts every listing and the pagination.
 */
const gapFiles = [
  "blog/2012/baz/yet-another/index.html",
  "baz/index.html",
  "index.html",
  "page2/index.html",
  "index.txt",
  "tango/index.html",
  "tango/index.md",
  "blog/2013/bar/more-work-here/index.html",
];

/**
 * Whether a file is text: everything the fixture carries except the
 * known binary asset formats.
 * @param {string} filePath
 * @returns {boolean}
 */
const isText = (filePath) =>
  ![".png", ".svg", ".gif", ".jpg", ".jpeg", ".ico", ".icon"].includes(
    extname(filePath).toLowerCase(),
  );

/**
 * Normalizes markdown-engine formatting differences: blank lines
 * between blocks collapse, trailing whitespace goes away.
 * @param {string} body
 * @returns {string}
 */
const normalize = (body) =>
  body
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trimEnd();

/**
 * Lists every file under a directory, relative to it.
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
const walk = (dir, prefix = "") => {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      files.push(...walk(full, rel));
      continue;
    }
    files.push(rel);
  }
  return files;
};

describe("jekyll parity", () => {
  it("matches the Jekyll reference on everything the build implements", async () => {
    const target = mkdtempSync(join(tmpdir(), "noflo-jekyll-parity-"));
    // The trace is the debugging artifact: every packet, activation pair
    // and lifecycle transition of the build, exported as a binary
    // flowtrace (work document #23) and uploaded by CI on failure
    const trace = new Flowtrace({
      runtimeMetadata: { name: "jekyll-parity", type: "in-process" },
    });
    // The build is expected to close down on its own; a watchdog turns
    // a stall into a fast failure with the trace dumped, so CI fails
    // with the diagnosable artifact instead of hanging to the runner
    // timeout
    let watchdog;
    try {
      await Promise.race([
        jekyll(source, target, { flowtrace: trace }),
        new Promise((_, reject) => {
          watchdog = setTimeout(
            () =>
              reject(
                new Error(
                  "the build did not close down within 30s — the flowtrace at .flowtrace/parity.trace shows where it stalled",
                ),
              ),
            30000,
          );
        }),
      ]);
    } finally {
      clearTimeout(watchdog);
      // Dump before asserting: a failing comparison still leaves the
      // trace for the stall/diff diagnosis
      mkdirSync(join(import.meta.dirname, "..", ".flowtrace"), {
        recursive: true,
      });
      // The JSON state always serializes (payloads are frugalized); the
      // binary trace is best-effort — a payload the msgpack encoder
      // cannot carry must not take the artifact down with it
      writeFileSync(
        join(import.meta.dirname, "..", ".flowtrace", "parity.json"),
        JSON.stringify(trace.toJSON()),
      );
      try {
        writeFileSync(
          join(import.meta.dirname, "..", ".flowtrace", "parity.trace"),
          assembleTraceFileFromRecorder(trace.toJSON()),
        );
      } catch (error) {
        console.error(
          "binary trace export failed:",
          /** @type {Error} */ (error).message,
        );
      }
    }

    const gapSet = new Set(gapFiles);
    const referenceFiles = walk(reference).filter((rel) => !gapSet.has(rel));
    const builtFiles = new Set(walk(target));

    /** @type {string[]} */
    const problems = [];
    for (const rel of referenceFiles) {
      if (!builtFiles.has(rel)) {
        problems.push(`missing: ${rel}`);
        continue;
      }
      const expected = readFileSync(join(reference, rel));
      const actual = readFileSync(join(target, rel));
      if (!isText(rel)) {
        if (!expected.equals(actual)) {
          problems.push(`binary differs: ${rel}`);
        }
        continue;
      }
      if (
        normalize(expected.toString("utf8")) !==
        normalize(actual.toString("utf8"))
      ) {
        problems.push(`content differs: ${rel}`);
      }
    }
    for (const rel of builtFiles) {
      if (!referenceFiles.includes(rel) && !gapSet.has(rel)) {
        problems.push(`unexpected: ${rel}`);
      }
    }

    assert.deepEqual(
      problems,
      [],
      `parity deviations:\n${problems.join("\n")}`,
    );
  });

  // The known gap, kept visible until it closes: the nested _posts
  // discovery (baz/_posts, with the path-derived category) and the
  // five files whose output depends on it. When it lands, move these
  // files out of gapFiles and the strict comparison covers them.
  it.todo(
    "renders the nested baz/_posts post with its path-derived category, the listings and pagination that include it (baz.html, index.html, page2/index.html, index.txt), and nested front-matter pages (tango/index.md)",
  );
  it.todo(
    "writes the first post in collection order (more-work-here) — it drops under the scoped drain in DocumentBuilder, likely a state-store drain-ordering edge (work document #35 update #20)",
  );
});
