FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
ENV NODE_ENV=production PORT=8790
WORKDIR /app
COPY integrations/hai/connector-server.js ./connector-server.js
USER node
EXPOSE 8790
CMD ["node", "connector-server.js"]
