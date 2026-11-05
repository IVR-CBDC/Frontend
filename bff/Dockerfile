









FROM node:22-alpine AS build
WORKDIR /app



RUN corepack enable && corepack prepare pnpm@11.3.0 --activate



COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build



RUN pnpm install --frozen-lockfile --prod


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist



USER node

EXPOSE 4000
CMD ["node", "dist/index.js"]
