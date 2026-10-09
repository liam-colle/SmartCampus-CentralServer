# Production image: one container serving the API and the built SPA.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install
COPY frontend/ ./
RUN pnpm build

FROM base AS backend-build
WORKDIR /build
COPY backend/package.json backend/pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install
COPY backend/ ./
RUN pnpm build

FROM base AS backend-deps
WORKDIR /app
COPY backend/package.json backend/pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod

FROM node:22-alpine AS runtime
ENV NODE_ENV=production STATIC_DIR=/app/public PORT=3000
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-build /build/dist ./dist
COPY --from=frontend-build /build/dist ./public
COPY backend/package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
