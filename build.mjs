import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const sourceDir = join(root, "src");
const distDir = join(root, "dist");
const staticDir = join(distDir, "static");
const serverDir = join(distDir, "server");

await rm(distDir, { recursive: true, force: true });
await mkdir(staticDir, { recursive: true });
await mkdir(serverDir, { recursive: true });

const files = ["index.html", "styles.css", "app.js"];
const assets = {};

for (const file of files) {
  const contents = await readFile(join(sourceDir, file), "utf8");
  assets[`/${file}`] = contents;
  await writeFile(join(staticDir, file), contents);
}

const workerSource = `const assets = ${JSON.stringify(assets)};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!assets[path] && !path.includes(".")) path = "/index.html";
    const body = assets[path];
    if (body === undefined) return new Response("Not found", { status: 404 });
    const extension = path.slice(path.lastIndexOf("."));
    return new Response(body, {
      headers: {
        "content-type": contentTypes[extension] || "text/plain; charset=utf-8",
        "cache-control": path === "/index.html" ? "no-cache" : "public, max-age=3600",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
      },
    });
  },
};
`;

await writeFile(join(serverDir, "index.js"), workerSource);
console.log(`Built ${files.length} static files and worker entrypoint.`);
