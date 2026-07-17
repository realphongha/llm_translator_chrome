import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

const isWatch = process.argv.includes("--watch");

// Ensure dist directory exists
if (!fs.existsSync("dist")) {
  fs.mkdirSync("dist", { recursive: true });
}

// Copy static assets to dist
function copyStatic() {
  const staticFiles = [
    { src: "src/popup/popup.html", dest: "dist/popup.html" },
    { src: "src/popup/popup.css", dest: "dist/popup.css" },
    { src: "src/options/options.html", dest: "dist/options.html" },
    { src: "src/options/options.css", dest: "dist/options.css" },
    { src: "manifest.json", dest: "dist/manifest.json" },
  ];

  for (const file of staticFiles) {
    if (fs.existsSync(file.src)) {
      fs.mkdirSync(path.dirname(file.dest), { recursive: true });
      fs.copyFileSync(file.src, file.dest);
    }
  }

  // Copy icons if present
  if (fs.existsSync("icons")) {
    fs.cpSync("icons", "dist/icons", { recursive: true });
  }
}

const sharedOptions = {
  bundle: true,
  format: /** @type {const} */ ("iife"),
  platform: /** @type {const} */ ("browser"),
  target: "chrome120",
  minify: !isWatch,
  sourcemap: isWatch ? "inline" : false,
};

const entryPoints = [
  { in: "src/background/index.ts", out: "dist/background" },
  { in: "src/content/index.ts", out: "dist/content" },
  { in: "src/popup/popup.ts", out: "dist/popup" },
  { in: "src/options/options.ts", out: "dist/options" },
];

async function build() {
  copyStatic();

  if (isWatch) {
    const contexts = await Promise.all(
      entryPoints.map((ep) =>
        esbuild.context({
          ...sharedOptions,
          entryPoints: [ep.in],
          outfile: ep.out + ".js",
          plugins: [
            {
              name: "static-copy",
              setup(build) {
                build.onEnd(() => {
                  copyStatic();
                  console.log(`[${new Date().toLocaleTimeString()}] Rebuilt`);
                });
              },
            },
          ],
        })
      )
    );

    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all(
      entryPoints.map((ep) =>
        esbuild.build({
          ...sharedOptions,
          entryPoints: [ep.in],
          outfile: ep.out + ".js",
        })
      )
    );
    console.log("Build complete → dist/");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
