# Hugging Face Space / container image. Rules-only mode unless ANTHROPIC_API_KEY is set as a Space secret.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7860
WORKDIR /app
COPY --from=build /app /app
RUN useradd -m app && chown -R app:app /app
USER app
EXPOSE 7860
CMD ["npm", "start"]
