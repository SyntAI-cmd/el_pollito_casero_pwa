// Recortes ilustrativos de la foto de cortes (source-images/trozado.png)
// para las tarjetas de producto. Coordenadas en la vista 900×600, escaladas al original 1536×1024.
import sharp from "sharp";
const k = 1536 / 900;
const cuts = {
  "cuarto-trasero": [20, 60, 420, 280],
  muslo: [360, 0, 400, 267],
  alas: [560, 220, 340, 227],
  pechuga: [230, 180, 390, 260],
  suprema: [200, 300, 360, 240],
  "pechuga-con-alas": [330, 150, 570, 380],
};
for (const [id, [x, y, w, h]] of Object.entries(cuts)) {
  await sharp("source-images/trozado.png")
    .extract({
      left: Math.round(x * k),
      top: Math.round(y * k),
      width: Math.round(w * k),
      height: Math.round(h * k),
    })
    .resize(768, 512, { fit: "cover" })
    .webp({ quality: 82 })
    .toFile(`public/images/${id}.webp`);
  console.log(id);
}
