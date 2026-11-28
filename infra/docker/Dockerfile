# One Dockerfile for the three processes of Loadlane. Build a target with:
#   docker build -f infra/docker/Dockerfile --target api    -t loadlane-api .
#   docker build -f infra/docker/Dockerfile --target web    -t loadlane-web .
#   docker build -f infra/docker/Dockerfile --target worker -t loadlane-worker .
# No secret is baked into an image: every setting comes from environment variables at run time
# (see .env.example). The images run as the unprivileged "node" user.

FROM node:26-slim AS base
ENV PNPM_HOME=/pnpm CI=true NEXT_TELEMETRY_DISABLED=1
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install --global pnpm@12.23.0 && npm cache clean --force
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @loadlane/api run build && pnpm --filter @loadlane/web run build

# ---- API: NestJS on port 4000 -------------------------------------------------------------
FROM build AS api
# Inside a container the API must listen on all interfaces, not only on localhost.
ENV NODE_ENV=production API_HOST=0.0.0.0
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4000/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

# ---- Web: Next.js on port 3000 ------------------------------------------------------------
FROM build AS web
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@loadlane/web", "run", "start"]

# ---- Worker: retention of old driver positions --------------------------------------------
FROM build AS worker
ENV NODE_ENV=production
USER node
CMD ["node", "apps/worker/src/main.ts"]
