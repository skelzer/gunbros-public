# GunBros — one process: the Node server, serving the built client and /ws (DESIGN §1.5).
#
# Four stages, so the image that ships holds no toolchain and no dev dependency:
#
#   base          node:22-alpine + pnpm through corepack
#   deps          every dependency, from the lockfile, for the build
#   build         pnpm build -> shared/dist, server/dist, client/dist
#   runtime-deps  the same lockfile again, production only, server subtree only
#   runner        server/dist + shared/dist + client/dist + those node_modules
#
# The manifests are copied before the sources on purpose: `pnpm install` is then cached
# and only re-runs when a package.json or the lockfile changes.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- every manifest the workspace has, and nothing else ----------------------
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
COPY e2e/package.json e2e/

# --- install + build ---------------------------------------------------------
FROM manifests AS deps
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm build

# --- the runtime dependency tree --------------------------------------------
# `@gunbros/server...` is the server and what it depends on (`@gunbros/shared`), so
# nothing of the client's or the test tooling's is installed. `--prod` drops every
# devDependency; the lockfile is the same one the build used.
FROM manifests AS runtime-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@gunbros/server..."

# --- the image that ships ----------------------------------------------------
FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /app

# node_modules first: `packages/server/node_modules/@gunbros/shared` is a symlink into
# `packages/shared`, which the next copies fill in.
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/packages/server/node_modules ./packages/server/node_modules

COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
# The server serves this at `/` with an SPA fallback (DESIGN §1.5); `config.clientDist`
# resolves it relative to `packages/server/dist`, so the layout above is the contract.
COPY --from=build /app/packages/client/dist ./packages/client/dist

# The admin portal's history (DATA_DIR, compose.yaml mounts a volume here). Made and
# owned here so a fresh named volume starts out writable by `node`.
RUN mkdir -p /data && chown node:node /data

# Shown in the admin portal; deploy.sh passes the short SHA. Last, so it never busts a
# cached layer above.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["node", "packages/server/dist/index.js"]
