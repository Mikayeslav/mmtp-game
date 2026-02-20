# MMtp — Multiplayer Game Server
# Build:  docker build -t mmtp .
# Run:    docker run -p 3000:3000 mmtp

FROM node:20-alpine

WORKDIR /app

# Copy server package files first (better layer caching)
COPY webapp-lobby/server/package*.json ./webapp-lobby/server/

# Install dependencies
RUN cd webapp-lobby/server && npm ci --omit=dev

# Copy the full webapp
COPY webapp-lobby/ ./webapp-lobby/

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# Start server
WORKDIR /app/webapp-lobby/server
CMD ["node", "index.js"]
