import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await fs.readFile(new URL("package.json", import.meta.url), "utf8"));
for (const [input, output] of [["src/index.ts", "server.mjs"], ["src/rpc.ts", "rpc.mjs"], ["src/jsonc.mjs", "jsonc.mjs"]]) {
  const result = await build({
    absWorkingDir: directory, entryPoints: [input], outfile: `dist/${output}`,
    bundle: true, format: "esm", platform: "node", target: "node18", metafile: true,
    mainFields: ["module", "main"],
    legalComments: "inline",
  });
  for (const file of Object.values(result.metafile.outputs)) {
    for (const dependency of file.imports) {
      if (!dependency.path.startsWith("node:")) throw new Error(`Unexpected runtime dependency: ${dependency.path}`);
    }
  }
}
await fs.writeFile(new URL("dist/package.json", import.meta.url), JSON.stringify({
  name: pkg.name, version: pkg.version, private: true, type: "module", license: pkg.license,
  exports: { ".": "./server.mjs", "./rpc": "./rpc.mjs", "./gui-experimental": "./gui-experimental.cjs" },
}, null, 2) + "\n");
await fs.copyFile(new URL("node_modules/jsonc-parser/LICENSE.md", import.meta.url), new URL("LICENSES/jsonc-parser-MIT.txt", import.meta.url));
console.log("Built offline server, RPC, config editor and deployment manifest (no runtime npm dependencies).");
