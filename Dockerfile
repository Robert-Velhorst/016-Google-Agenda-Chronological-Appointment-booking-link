FROM node:26.12.0-alpine AS build
WORKDIR /app
RUN npm install --global npm@12.2.0 --no-audit --no-fund
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run check && npm test

FROM node:26.12.0-alpine AS runtime
ENV APP_ENV=production NODE_ENV=production PORT=8787
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
