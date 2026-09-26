# PRFKT CLAW web/control plane — Node 22, Next.js standalone output, non-root.
# Build:  docker build --build-arg NEXT_PUBLIC_APP_URL=https://claw.example.com \
#           --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t prfkt-claw .
# Run:    docker run -p 3000:3000 --env-file .env.production prfkt-claw
# Server-only secrets (DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...) are runtime env, never build args.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_COMPANY_NAME
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_SECURITY_CONTACT
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_COMPANY_NAME=$NEXT_PUBLIC_COMPANY_NAME \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_PUBLIC_SECURITY_CONTACT=$NEXT_PUBLIC_SECURITY_CONTACT
# public/ is optional (git does not track empty dirs); ensure it exists for the copy below.
RUN mkdir -p public && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "server.js"]
