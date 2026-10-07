FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY samples/sample-vocabulary.tsv ./samples/sample-vocabulary.tsv
ARG VITE_SOURCE_URL=https://github.com/so-nagi/modoo-cards
ENV VITE_SOURCE_URL=$VITE_SOURCE_URL
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Seoul \
    MODOO_DATA_DIR=/var/data/modoo-cards
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-runtime.txt ./
RUN pip install --no-cache-dir -r requirements-runtime.txt
COPY server ./server
COPY --from=frontend /build/dist ./dist
EXPOSE 10000
CMD ["python", "-m", "server.serve"]
