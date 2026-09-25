import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  renderToBuffer,
} from "@react-pdf/renderer";
import sharp from "sharp";

export const imageDigest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function createEvidenceSigner(dataDir) {
  let pending;
  async function load() {
    const dir = join(dataDir, "receipt-evidence");
    const path = join(dir, "signing-key.pem");
    await mkdir(dir, { recursive: true });
    try {
      return createPrivateKey(await readFile(path));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const { privateKey } = generateKeyPairSync("ed25519");
    try {
      await writeFile(
        path,
        privateKey.export({ type: "pkcs8", format: "pem" }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    return createPrivateKey(await readFile(path));
  }
  return async (payload) => {
    const key = await (pending ||= load().catch((error) => {
      pending = null;
      throw error;
    }));
    const payloadJson = JSON.stringify(payload);
    return {
      payload,
      payloadJson,
      signature: sign(null, Buffer.from(payloadJson), key).toString("base64"),
      publicKey: createPublicKey(key).export({ type: "spki", format: "pem" }),
    };
  };
}
export function verifyEvidence(evidence, bytes) {
  try {
    return (
      evidence.payloadJson === JSON.stringify(evidence.payload) &&
      evidence.payload.imageSha256 === imageDigest(bytes) &&
      verify(
        null,
        Buffer.from(evidence.payloadJson),
        evidence.publicKey,
        Buffer.from(evidence.signature, "base64"),
      )
    );
  } catch {
    return false;
  }
}
const h = React.createElement;
const fmt = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
    n,
  );
export async function receiptEvidencePdf(receipt, bytes) {
  const e = receipt.evidence;
  if (e && !verifyEvidence(e, bytes))
    throw Error("No coincide la integridad del comprobante guardado.");
  const p = e?.payload;
  const image = await sharp(bytes, { limitInputPixels: 40000000 })
    .rotate()
    .resize({
      width: 1800,
      height: 1800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const line = (text, style = {}) =>
    h(Text, { style: { fontSize: 9, marginBottom: 4, ...style } }, text);
  return renderToBuffer(
    h(
      Document,
      { title: `Constancia ${receipt.id}`, author: "El Pollito Casero" },
      h(
        Page,
        {
          size: "A4",
          style: { padding: 30, fontFamily: "Helvetica", fontSize: 9 },
        },
        line("EL POLLITO CASERO", {
          fontSize: 17,
          color: "#c9262e",
          fontFamily: "Helvetica-Bold",
        }),
        line("CONSTANCIA DE CARGA DE COMPROBANTE", {
          fontSize: 13,
          fontFamily: "Helvetica-Bold",
        }),
        line(
          `Comprobante: ${receipt.id} · Pedido: ${p?.orderNumber || receipt.orderId}`,
        ),
        p?.customerName ? line(`Cliente: ${p.customerName}`) : null,
        line(
          `Subido por: ${p?.actor.nombre || receipt.by || "Sin registro"} · ID: ${p?.actor.id || "No registrado en el comprobante histórico"}`,
        ),
        line(
          `Rol: ${p?.actor.rol || "No registrado"} · Fecha de carga: ${new Date(p?.at || receipt.at).toLocaleString("es-AR", { timeZone: "America/Argentina/Mendoza" })} (Mendoza)`,
        ),
        line(
          `Tipo al subir: ${p?.kind || receipt.kind}${p?.amount ? " · Importe: " + fmt(p.amount) : ""}`,
        ),
        p?.customerBalance > 0
          ? line(`Deuda del cliente al subir: ${fmt(p.customerBalance)}`)
          : null,
        p?.note ? line(`Nota al subir: ${p.note}`) : null,
        receipt.voided
          ? line("COMPROBANTE ANULADO", {
              color: "#c9262e",
              fontFamily: "Helvetica-Bold",
            })
          : null,
        h(
          View,
          {
            style: {
              height: 420,
              marginVertical: 10,
              borderWidth: 0.5,
              borderColor: "#ccc",
            },
          },
          h(Image, {
            src: { data: image, format: "png" },
            style: { width: "100%", height: "100%", objectFit: "contain" },
          }),
        ),
        line(
          "Constancia automática de la sesión autenticada. La firma del sistema certifica el registro de carga; no es una firma manuscrita ni una validación del pago.",
          { fontSize: 8 },
        ),
        line(`SHA-256 de la imagen: ${imageDigest(bytes)}`, { fontSize: 7 }),
        e
          ? line(`Firma del sistema (Ed25519): ${e.signature}`, { fontSize: 7 })
          : line(
              "Registro histórico sin firma digital ni ID verificable del usuario.",
              { fontSize: 8 },
            ),
        e
          ? line(
              `Clave pública: ${e.publicKey.replace(/-----[^\n]+-----/g, "").replace(/\s/g, "")}`,
              { fontSize: 7 },
            )
          : null,
        line(
          "La constancia conserva los datos originales de carga. Las correcciones posteriores figuran en el historial.",
          { fontSize: 8 },
        ),
      ),
    ),
  );
}
