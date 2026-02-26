# =============================================================================
# matware/e2e-runner-mcp — MCP server image (stdio transport)
#
# Build:
#   docker build -t fastslack/e2e-runner-mcp:latest -t fastslack/e2e-runner-mcp:1.2.1 .
#
# Use with Claude Code:
#   claude mcp add --transport stdio --scope user e2e-runner -- docker run -i --rm fastslack/e2e-runner-mcp
# =============================================================================

FROM node:20-alpine AS build

# better-sqlite3 needs build tools for native compilation on Alpine (musl)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY bin/ bin/
COPY src/ src/
COPY templates/ templates/

FROM node:20-alpine

LABEL io.modelcontextprotocol.server.name="io.github.fastslack/e2e-runner"

RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 e2erunner && \
    adduser -u 1001 -G e2erunner -s /bin/sh -D e2erunner

WORKDIR /app
COPY --from=build /app /app

WORKDIR /workspace

ENV CHROME_POOL_URL=ws://host.docker.internal:3333
ENV BASE_URL=http://host.docker.internal:3000
ENV NODE_ENV=production

RUN chown -R e2erunner:e2erunner /app && \
    chown -R e2erunner:e2erunner /workspace

USER e2erunner

ENTRYPOINT ["dumb-init", "node", "/app/bin/mcp-server.js"]
