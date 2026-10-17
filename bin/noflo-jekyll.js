#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { stat } from "node:fs/promises";
import { jekyll } from "../lib/Jekyll.js";

const source = path.resolve(process.argv[2]);
const target = path.resolve(process.argv[3]);

if (process.argv.length !== 4) {
  console.log(`Usage: $ noflo-jekyll source_dir target_dir`);
  process.exit(0);
}

try {
  await stat(source);
} catch {
  console.error(`Source directory ${source} doesn't exist`);
  process.exit(1);
}

console.log(`NoFlo Jekyll ${source} -> ${target}`);

try {
  const started = Date.now();
  const output = await jekyll(source, target);
  const written = output.written ?? [];
  const copied = output.copied ?? [];
  for (const file of written) {
    console.log(`Created file ${file.path ?? file}`);
  }
  for (const file of copied) {
    console.log(`Copied ${file.destination ?? file}`);
  }
  console.log(`Build finished in ${(Date.now() - started) / 1000} sec.`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
