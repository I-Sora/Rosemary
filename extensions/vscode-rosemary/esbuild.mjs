import { build } from "esbuild";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "esm",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
});

