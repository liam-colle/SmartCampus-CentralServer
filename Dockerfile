# Production image: one container serving the API, the device gateway and the built SPA.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
COPY packages/handshake/package.json packages/handshake/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY apps/ apps/
COPY packages/ packages/
RUN pnpm -r build
RUN pnpm --filter @smartcampus/server --prod deploy --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production STATIC_DIR=/app/public PORT=3000
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/web/dist ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
