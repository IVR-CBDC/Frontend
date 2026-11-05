










FROM node:22-alpine AS build
WORKDIR /app



RUN corepack enable && corepack prepare pnpm@11.3.0 --activate



COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./





COPY src ./src
RUN pnpm build






FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
