// The anomaly hunt with traces: loop builds of the parity fixture site,
// each recorded into its own Flowtrace; retain one good and one bad tree
// plus their traces, then compare the per-process DATA flows to locate
// the stage where the root-pages leg's messages vanish.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Flowtrace } from "@noflo/noflo";
import { jekyll } from "../lib/Jekyll.js";

const source = join(import.meta.dirname, "..", "test", "fixtures", "source");
const RUNS = Number(process.env.RUNS ?? 20);

/**
 * Hash an output tree: sorted relative paths with content digests.
 * @param {string} root
 * @returns {{ count: number, hash: string }}
 */
function treeHash(root) {
  const entries = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(root, full);
      const digest = createHash("sha256")
        .update(readFileSync(full))
        .digest("hex")
        .slice(0, 16);
      entries.push(`${rel}:${digest}`);
    }
  };
  walk(root);
  entries.sort();
  return {
    count: entries.length,
    hash: createHash("sha256").update(entries.join("\n")).digest("hex"),
  };
}

/**
 * Aggregate DATA events per process pair from a trace's chunk stream.
 * @param {any} json
 * @returns {Record<string, number>}
 */
function dataFlows(json) {
  /** @type {Record<string, number>} */
  const flows = {};
  for (const chunk of json.chunks) {
    const [, eventType, payload, meta4] = chunk;
    if (eventType !== 0x01) continue;
    // The packet events carry src/tgt in the chunk META (the fourth
    // element), not the payload — the payload carries the value
    const meta = meta4 ?? {};
    const src = meta.src?.node ?? "?";
    const tgt = meta.tgt?.node ?? "?";
    const key = `${src}:${meta.src?.port ?? ""} -> ${tgt}:${meta.tgt?.port ?? ""}${meta.subgraph ? ` @${meta.subgraph}` : ""}`;
    flows[key] = (flows[key] ?? 0) + 1;
  }
  return flows;
}

// One retained sample per distinct tree hash (count + trace); the hash with
// the majority of runs counts as good, every other hash is a variant to diff.
/** @type {Map<string, { target: string, trace: any, count: number, run: number }>} */
const samples = new Map();
/** @type {Map<string, number>} */
const hashCounts = new Map();

for (let run = 1; run <= RUNS; run += 1) {
  const target = mkdtempSync(join(tmpdir(), "noflo-jekyll-trace-"));
  const trace = new Flowtrace({
    runtimeMetadata: { name: "jekyll-stress", type: "in-process" },
  });
  // The recorder snapshots DATA payloads at record time (noflo/noflo#1104):
  // traces show send-time state, not the final state of shared objects
  try {
    await Promise.race([
      jekyll(source, target, { flowtrace: trace }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("build did not close down in 60s")), 60000),
      ),
    ]);
  } catch (err) {
    console.log(`run ${run}: FAILED — ${err?.message ?? err}`);
    rmSync(target, { recursive: true, force: true });
    continue;
  }
  const { count, hash } = treeHash(target);
  hashCounts.set(hash, (hashCounts.get(hash) ?? 0) + 1);
  console.log(`run ${run}: ${count} files, tree ${hash.slice(0, 12)}`);
  if (!samples.has(hash)) {
    samples.set(hash, { target, trace: trace.toJSON(), count, run });
  } else {
    rmSync(target, { recursive: true, force: true });
  }
  // Stop once the majority-good hash and two variants are retained
  if (samples.size >= 3) break;
}

console.log(`--- distinct hashes across ${RUNS} runs: ${samples.size}`);
for (const [hash, n] of [...hashCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${hash.slice(0, 12)} x${n}`);
}
const ranked = [...hashCounts.entries()].sort((a, b) => b[1] - a[1]);
const goodHash = ranked[0]?.[0];
const good = goodHash ? samples.get(goodHash) : null;
if (!good) {
  console.log("no runs captured");
  process.exit(0);
}
const goodFlows = dataFlows(good.trace);
const dumpDir = join(import.meta.dirname, "..", ".flowtrace");
mkdirSync(dumpDir, { recursive: true });
writeFileSync(join(dumpDir, "stress-good.json"), JSON.stringify(good.trace));
console.log(`good run ${good.run} (${good.count} files, ${goodHash.slice(0, 12)})`);
for (const [hash] of ranked.slice(1)) {
  const variant = samples.get(hash);
  if (!variant) continue;
  const badFlows = dataFlows(variant.trace);
  const keys = [...new Set([...Object.keys(goodFlows), ...Object.keys(badFlows)])].sort();
  console.log(`--- variant run ${variant.run} (${variant.count} files, ${hash.slice(0, 12)}) vs good — DATA flows per edge (good | bad):`);
  for (const key of keys) {
    const g = goodFlows[key] ?? 0;
    const b = badFlows[key] ?? 0;
    if (g !== b) {
      console.log(`  DIFF ${g}\t${b}\t${key}`);
    }
  }
  writeFileSync(join(dumpDir, `stress-variant-${hash.slice(0, 8)}.json`), JSON.stringify(variant.trace));
  console.log(`  trace dumped to .flowtrace/stress-variant-${hash.slice(0, 8)}.json (target kept: ${variant.target})`);
}
