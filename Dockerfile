# ---- web app -----------------------------------------------------------------
FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- server ------------------------------------------------------------------
FROM python:3.12-slim
WORKDIR /app
ENV TRIAGE_HOME=/app TRIAGE_FRONTEND_DIR=/app/frontend/dist PYTHONUNBUFFERED=1
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir . && python -c "import duckdb; duckdb.connect().execute('INSTALL httpfs')"
COPY config ./config
COPY evals ./evals
COPY --from=ui /ui/dist ./frontend/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN useradd --create-home triage && mkdir -p logs data && chown -R triage /app
USER triage
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
ENTRYPOINT ["entrypoint.sh"]
CMD ["triage", "serve"]
