FROM node:24-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS test
COPY . .
RUN npm run lint
RUN npm run test

FROM node:24-slim AS api-runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY api ./api
USER node
EXPOSE 3001
CMD ["node", "api/server.js"]

FROM node:24-slim AS frontend-runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY frontend ./frontend
COPY public ./public
COPY views ./views
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
