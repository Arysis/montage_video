# Image unique pour le site (next start) et le worker (montage et rendu vidéo).
# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Les variables NEXT_PUBLIC_* sont figées au build.
ARG NEXT_PUBLIC_DEMO_VIDEO_URL=""
ARG NEXT_PUBLIC_DEMO_POSTER_URL=""
ARG NEXT_PUBLIC_SHOW_CAPTURES="0"
ENV NEXT_PUBLIC_DEMO_VIDEO_URL=$NEXT_PUBLIC_DEMO_VIDEO_URL \
    NEXT_PUBLIC_DEMO_POSTER_URL=$NEXT_PUBLIC_DEMO_POSTER_URL \
    NEXT_PUBLIC_SHOW_CAPTURES=$NEXT_PUBLIC_SHOW_CAPTURES
RUN npm run build && npm run build:worker && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
# FFmpeg (rendu, contrôle qualité) et fontconfig (polices des sous-titres).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app --home /app app
COPY --from=build --chown=app:app /app/package.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/assets ./assets
COPY --from=build --chown=app:app /app/next.config.ts ./next.config.ts
RUN mkdir -p /app/.data && chown app:app /app/.data
USER app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Par défaut : le site. Le worker se lance avec « node dist/worker/index.js ».
CMD ["node_modules/.bin/next", "start"]
