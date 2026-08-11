FROM node:20-alpine AS build

WORKDIR /app

# Vazio = mesmo origem (Nginx na VPS proxy /api).
# Na Vercel: define VITE_BACKEND_URL=http(s)://IP_OU_DOMÍNIO_INTERSERVER
ARG VITE_BACKEND_URL=
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM nginx:alpine

COPY --from=build /app/dist/ /usr/share/nginx/html/

# Single-page app fallback
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location / {' \
  '    try_files $uri $uri/ /index.html;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
