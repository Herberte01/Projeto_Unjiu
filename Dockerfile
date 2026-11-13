FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
# /data guarda o banco e as fotos: monte um volume persistente nesse caminho.
ENV NODE_ENV=production TRUST_PROXY=1 PORT=3000 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/site >/dev/null || exit 1
CMD ["node", "server/index.js"]
