FROM node:20-alpine

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ ffmpeg

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

# Create media directories
RUN mkdir -p /var/media/music /var/media/jingles /var/media/ads /var/recordings /app/migrations

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget --spider -q http://localhost:3000/api/health || exit 1

CMD ["node", "src/index.js"]
