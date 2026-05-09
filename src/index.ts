#!/usr/bin/env node

import { createServer } from "./server.js";

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFile(join(here, "..", "package.json"), "utf-8"));
    console.log(pkg.version);
    return;
  }
  const server = await createServer();
  await server.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
