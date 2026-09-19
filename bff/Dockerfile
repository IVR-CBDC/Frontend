# syntax=docker/dockerfile:1
#
# Продовый образ BFF. Собирается из каталога bff/ (это контекст сборки —
# см. docker-compose.override.yml.example в Backend-репозитории), не из
# корня монорепозитория, поэтому пути ниже относительны bff/.
#
# HEALTHCHECK намеренно не задаётся здесь — он определён в compose
# (docker-compose.yml сервиса bff в Backend-репозитории), как принято для
# остальных сервисов в этом стенде.

FROM node:22-alpine AS build
WORKDIR /app

# corepack фиксирует ту же версию pnpm, что и в окружении разработки
# (11.3.0), чтобы --frozen-lockfile не спотыкался о расхождение resolver'ов.
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Сначала только манифесты — слой с зависимостями кешируется отдельно от
# исходников, пересборка при правке src/ не тянет npm install заново.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Прод-зависимости отдельно от dev: после сборки dist/ исходники и
# devDependencies (vitest, typescript, tsx, supertest) рантайму не нужны.
RUN pnpm install --frozen-lockfile --prod


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# node:22-alpine уже содержит непривилегированного пользователя "node"
# (uid 1000) — свой не заводим.
USER node

EXPOSE 4000
CMD ["node", "dist/index.js"]
