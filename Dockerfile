FROM node:24-slim AS test

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run lint

RUN npm run test


FROM node:24-slim AS runtime

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

USER node

CMD [ "node", "index.js" ]