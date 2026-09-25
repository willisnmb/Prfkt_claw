# PRFKT runtime cell image: one OpenClaw per customer trust domain.
# Pinned version; runs as the unprivileged `node` user. The controller starts
# it with --network none, a read-only root, dropped capabilities and limits.
FROM node:24-bookworm-slim
ARG OPENCLAW_VERSION=2026.9.4
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NODE_ENV=production
RUN npm install -g "openclaw@${OPENCLAW_VERSION}" && npm cache clean --force
USER node
WORKDIR /home/node
# Volume mount points must exist and be owned by `node`. Backups live on a
# separate volume: OpenClaw refuses to write a backup inside its own state dir.
RUN mkdir -p /home/node/.openclaw /home/node/backups
ENV OPENCLAW_STATE_DIR=/home/node/.openclaw
LABEL org.prfkt.component="runtime-cell" org.prfkt.runtime="openclaw"
ENTRYPOINT ["openclaw"]
