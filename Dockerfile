FROM node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS node-toolchain
RUN npm install --global npm@12.2.1 --no-audit --no-fund

FROM python:3.15.1-alpine3.24@sha256:54448f67d7c31c39e5cdd3ea2d6382395ce142806c284425f8e897d78a0465b3 AS build
COPY --from=node-toolchain /usr/local /usr/local
RUN apk add --no-cache make g++
ENV PYTHON=/usr/local/bin/python3
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:sqlite && npm run verify:runtime && npm run check && npm test && npm run build

FROM node-toolchain AS production-dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && rm -rf /app/node_modules/better-sqlite3
# Ship the qualified addon and runtime JavaScript; exclude obsolete prebuilds,
# original SQLite sources and intermediate native build files.
COPY --from=build /app/node_modules/better-sqlite3/package.json /app/node_modules/better-sqlite3/LICENSE ./node_modules/better-sqlite3/
COPY --from=build /app/node_modules/better-sqlite3/lib ./node_modules/better-sqlite3/lib
COPY --from=build /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node ./node_modules/better-sqlite3/build/Release/better_sqlite3.node

FROM node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS runtime
ENV APP_ENV=production NODE_ENV=production PORT=8787
WORKDIR /app
COPY package*.json sqlite-build.json LICENSE ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/output/sqlite-build-verification.json ./output/sqlite-build-verification.json
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
