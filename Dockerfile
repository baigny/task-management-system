FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y openssl --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build

# Migrations run once as a separate job; the API image does not need the CLI.
FROM build AS migrations
CMD ["npm", "run", "db:migrate"]

FROM base AS production-deps
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
