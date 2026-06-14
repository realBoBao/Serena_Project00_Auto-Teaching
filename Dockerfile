# ═══════════════════════════════════════════════════════════════
# Dockerfile — my-ai-brain (Node.js)
# ═══════════════════════════════════════════════════════════════

FROM node:20-slim

WORKDIR /app

# Copy dependency files first (cache layer)
COPY package.json package-lock.json* ./

# Install production dependencies
RUN npm ci --legacy-peer-deps --only-production 2>&1 || npm install --legacy-peer-deps --only-production

# Copy source code
COPY . .

# Security: Non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

# Environment
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

EXPOSE 8080

CMD ["node", "--experimental-vm-modules", "rest_api_server.js"]
