# Pollito Casero: una sola imagen con la API (Node 24 + SQLite) y la PWA compilada.
# Datos persistentes en /data (montar un volumen ahí: base, copias de seguridad y claves push).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    APP_MODE=equipo
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs /app/domain.mjs /app/business.json /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/scripts/limpiar.mjs ./scripts/limpiar.mjs
# Corre como root: Railway monta el volumen de /data como root y el usuario "node" no podría escribir la base.
RUN mkdir -p /data
# Verificación: los módulos del servidor resuelven todas sus importaciones dentro de la imagen
# (si falta un archivo, falla el build en vez de caerse el servicio ya desplegado).
RUN node --input-type=module -e "await import('./server/api.mjs'); await import('./server/floor.mjs'); await import('./server/auth.mjs'); await import('./server/store.mjs')"
# El volumen se monta desde Railway (Settings → Volumes → /data); Railway rechaza la instrucción VOLUME.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server.mjs"]
