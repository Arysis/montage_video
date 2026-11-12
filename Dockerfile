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

# Transcription locale de la voix (sous-titres de ce qui est vraiment dit) : whisper.cpp et son modèle,
# plus le modèle RNNoise de débruitage de la voix. Aucune clé ni service en ligne nécessaire.
FROM debian:bookworm-slim AS speech
ARG WHISPER_VERSION=v1.7.6
# small-q5_1 (190 Mo) : bon en français et assez rapide sur un petit serveur. base-q5_1 : 2 fois plus
# rapide, moins précis. medium-q5_0 : plus précis, 3 fois plus lent.
ARG WHISPER_MODEL=small-q5_1
ARG RNNOISE_MODELS_COMMIT=3eee541a283fd3b8f81b85b1748e3b9ccbefa04d
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git curl ca-certificates ffmpeg espeak-ng \
  && rm -rf /var/lib/apt/lists/*
# Optimisé pour les processeurs x86-64 avec AVX2 (serveurs actuels), sans dépendre de la machine de build.
RUN git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp /src \
  && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
       -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
       -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=ON \
  && cmake --build /build -j"$(nproc)" --target whisper-cli \
  && install -D /build/bin/whisper-cli /opt/whisper/whisper-cli
RUN curl -fsSL --retry 4 -o /opt/whisper/model.bin \
       "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin" \
  && mkdir -p /opt/rnnoise \
  && curl -fsSL --retry 4 -o /opt/rnnoise/voice.rnnn \
       "https://raw.githubusercontent.com/GregorR/rnnoise-models/${RNNOISE_MODELS_COMMIT}/beguiling-drafter-2018-08-30/bd.rnnn" \
  && echo "ae3f7411e1e6a884f839a4a145c394408398f09854dbc1216ee02faafc98a17b  /opt/rnnoise/voice.rnnn" | sha256sum -c -
# Essai : une phrase de synthèse doit être transcrite, sinon l'image n'est pas construite.
RUN espeak-ng -v fr -w /tmp/essai.wav "Bonjour à tous, voici un essai de transcription." \
  && ffmpeg -loglevel error -i /tmp/essai.wav -ac 1 -ar 16000 -c:a pcm_s16le /tmp/essai16.wav \
  && /opt/whisper/whisper-cli -m /opt/whisper/model.bin -f /tmp/essai16.wav -l fr -ml 1 -sow -oj -of /tmp/essai -np \
  && cat /tmp/essai.json \
  && grep -qi "bonjour" /tmp/essai.json

FROM node:22-bookworm-slim AS runtime
# FFmpeg (rendu, contrôle qualité), fontconfig (polices des sous-titres), libgomp1 (whisper.cpp).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig ca-certificates tini libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=speech /opt/whisper /opt/whisper
COPY --from=speech /opt/rnnoise /opt/rnnoise
WORKDIR /app
# XDG_CACHE_HOME : cache de fontconfig (sous-titres) dans un dossier inscriptible par l'utilisateur app.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 XDG_CACHE_HOME=/tmp/cache \
    WHISPER_CLI_PATH=/opt/whisper/whisper-cli WHISPER_MODEL_PATH=/opt/whisper/model.bin \
    VOICE_DENOISE_MODEL=/opt/rnnoise/voice.rnnn
RUN groupadd --system app && useradd --system --gid app --home /app app
COPY --from=build --chown=app:app /app/package.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/assets ./assets
COPY --from=build --chown=app:app /app/next.config.mjs ./next.config.mjs
RUN mkdir -p /app/.data && chown app:app /app/.data
USER app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Par défaut : le site. Le worker se lance avec « node dist/worker/index.js ».
CMD ["node_modules/.bin/next", "start"]
