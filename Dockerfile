# =============================================================================
# matware/e2e-runner:latest — CLI-only image (~150-200MB)
#
# Lightweight image that connects to an external Chrome Pool (browserless/chrome).
# Users mount their tests and config into /workspace.
#
# Build:
#   docker build -t matware/e2e-runner:latest -t matware/e2e-runner:1.0.0 -f Dockerfile .
#
# Usage:
#   docker run --rm \
#     -v $(pwd)/e2e:/workspace/e2e \
#     -v $(pwd)/e2e.config.js:/workspace/e2e.config.js \
#     -e BASE_URL=http://host.docker.internal:3000 \
#     matware/e2e-runner:latest run --all
# =============================================================================

# --- Stage 1: install dependencies ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY bin/ bin/
COPY src/ src/
COPY templates/ templates/

# --- Stage 2: production runtime ---
FROM node:20-alpine

RUN apk add --no-cache dumb-init

# Non-root user for security
RUN addgroup -g 1001 e2erunner && \
    adduser -u 1001 -G e2erunner -s /bin/sh -D e2erunner

WORKDIR /app
COPY --from=build /app /app

# Working directory where users mount their tests and config
WORKDIR /workspace

# Default environment: Chrome Pool and app running on Docker host
ENV CHROME_POOL_URL=ws://host.docker.internal:3333
ENV BASE_URL=http://host.docker.internal:3000
ENV NODE_ENV=production

# Set ownership for non-root user
RUN chown -R e2erunner:e2erunner /app && \
    chown -R e2erunner:e2erunner /workspace

USER e2erunner

ENTRYPOINT ["dumb-init", "node", "/app/bin/cli.js"]
CMD ["--help"]
