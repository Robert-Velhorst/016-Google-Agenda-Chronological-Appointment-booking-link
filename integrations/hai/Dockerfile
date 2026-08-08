FROM node:24.18.1-alpine
ENV NODE_ENV=production PORT=8790
WORKDIR /app
COPY integrations/hai/connector-server.js ./connector-server.js
USER node
EXPOSE 8790
CMD ["node", "connector-server.js"]
