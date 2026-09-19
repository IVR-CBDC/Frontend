# syntax=docker/dockerfile:1
#
# Продовый образ SPA. Собирается из каталога frontend/ (это контекст сборки,
# см. docker-compose.override.yml.example в Backend-репозитории — по
# аналогии с bff/Dockerfile), не из корня монорепозитория, поэтому пути ниже
# относительны frontend/.
#
# HEALTHCHECK намеренно не задаётся здесь — он определён в compose
# (docker-compose.yml сервиса frontend в Backend-репозитории), как принято
# для остальных сервисов в этом стенде (см. bff/Dockerfile).

FROM node:22-alpine AS build
WORKDIR /app

# corepack фиксирует ту же версию pnpm, что и в окружении разработки
# (11.3.0), чтобы --frozen-lockfile не спотыкался о расхождение resolver'ов.
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Сначала только манифесты — слой с зависимостями кешируется отдельно от
# исходников, пересборка при правке src/ не тянет install заново.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN pnpm build


# F11 (final review): стоковый nginx:alpine слушает :80 и не задаёт USER —
# под политикой "restricted" (или runAsNonRoot: true, план 08) под с ним не
# стартует, привязка к :80 требует root. nginx-unprivileged — тот же образ,
# но слушает 8080 и уже настроен на непривилегированного пользователя.
FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
