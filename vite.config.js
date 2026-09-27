import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "pollito-offline-cache",
      apply: "build",
      async closeBundle() {
        const html = await readFile("dist/index.html", "utf8");
        const hash = createHash("sha256")
          .update(html)
          .digest("hex")
          .slice(0, 12);
        // Precache: lo necesario para trabajar sin señal (todas las pantallas, estilos y
        // fuentes). Quedan afuera el motor de PDF (1,2 MB, sólo al imprimir) y las fotos del
        // catálogo (portal de clientes): se guardan en la caché la primera vez que se usan.
        const assets = (await readdir("dist/assets"))
          .filter((f) => /\.(js|css|woff2)$/.test(f) && !/^pdf\.worker/.test(f))
          .map((f) => "/assets/" + f);
        const sw = await readFile("dist/sw.js", "utf8");
        await writeFile(
          "dist/sw.js",
          sw
            .replace("__BUILD_ID__", hash)
            .replace(/\/\* PRECACHE \*\/\s*\[\]/, JSON.stringify(assets)),
        );
      },
    },
  ],
});
