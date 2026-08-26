# 砚都跨境 业务服务端（Fastify + Prisma）
FROM node:22-bookworm AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --registry=https://registry.npmmirror.com
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN npx prisma generate
EXPOSE 8787
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
