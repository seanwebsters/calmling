# Persistent simulation service. Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t calmling-worker .
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @calmling/worker --workspace @calmling/core --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/worker apps/worker
COPY db db
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start", "-w", "@calmling/worker"]
