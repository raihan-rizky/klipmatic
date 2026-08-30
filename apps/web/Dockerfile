FROM oven/bun:1.3.13
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN bun install --frozen-lockfile
COPY . .
RUN bun run --cwd=apps/web build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "--cwd=apps/web", "start"]
