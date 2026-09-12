import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
await mkdir("public/images", { recursive: true });
await sharp("source-images/pollo.png")
  .resize(1440)
  .webp({ quality: 85 })
  .toFile("public/images/pollo.webp");
await sharp("source-images/trozado.png")
  .resize(1440)
  .webp({ quality: 85 })
  .toFile("public/images/trozado.webp");
// Recortes 3:2 de la foto de cortes (1536×1024) para las tarjetas del catálogo.
const crops = {
  "cuarto-trasero": { left: 40, top: 120, width: 690, height: 460 },
  muslo: { left: 600, top: 0, width: 690, height: 460 },
  pechuga: { left: 380, top: 330, width: 690, height: 460 },
  suprema: { left: 330, top: 480, width: 690, height: 460 },
  alas: { left: 846, top: 330, width: 690, height: 460 },
  "pechuga-con-alas": { left: 690, top: 320, width: 846, height: 564 },
};
for (const [id, region] of Object.entries(crops))
  await sharp("source-images/trozado.png")
    .extract(region)
    .resize(768, 512)
    .webp({ quality: 82 })
    .toFile(`public/images/${id}.webp`);
// Fotos aportadas por el negocio sobre fondo blanco: se encuadran completas (contain) en 3:2.
for (const id of ["menudos", "rancho", "garras"]) {
  const src = ["jpg", "jpeg", "png", "webp"].map((ext) => `source-images/${id}.${ext}`).find((p) => existsSync(p));
  if (!src) continue;
  await sharp(src)
    .flatten({ background: "#ffffff" })
    .resize(768, 512, { fit: "contain", background: "#ffffff" })
    .webp({ quality: 84 })
    .toFile(`public/images/${id}.webp`);
}
const icon = await readFile("public/icon.svg");
await sharp(icon).resize(192).png().toFile("public/icon-192.png");
await sharp(icon).resize(512).png().toFile("public/icon-512.png");
const og = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#20201e"/><rect x="0" y="0" width="15" height="630" fill="#cc242a"/><text x="85" y="120" fill="#ffffff" font-family="sans-serif" font-size="36" font-weight="700">pollito casero</text><text x="85" y="260" fill="#ffffff" font-family="sans-serif" font-size="62" font-weight="700">Buen pollo.</text><text x="85" y="340" fill="#ffffff" font-family="sans-serif" font-size="62" font-weight="700">Buena compañía.</text><text x="85" y="425" fill="#d4d1c7" font-family="sans-serif" font-size="25">Pollo fresco por kilo · San Martín, Mendoza</text><rect x="85" y="475" width="260" height="58" rx="8" fill="#cc242a"/><text x="115" y="512" fill="#fff" font-family="sans-serif" font-size="23">Armá tu pedido</text></svg>`,
);
const photo = await sharp("public/images/pollo.webp")
  .resize(460, 550, { fit: "cover" })
  .png()
  .toBuffer();
await sharp(og)
  .composite([{ input: photo, left: 700, top: 40 }])
  .png()
  .toFile("public/og.png");
console.log("Imágenes, recortes por corte, iconos y OG 1200×630 creados.");
