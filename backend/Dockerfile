FROM python:3.12-slim

# libgomp: LightGBM / implicit OpenMP runtime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9.24 /uv /usr/local/bin/uv

WORKDIR /app
# dependencies first (cached layer), then the code
COPY pyproject.toml ./
RUN uv pip install --system --no-cache -r pyproject.toml
COPY cinegraph ./cinegraph
RUN uv pip install --system --no-cache --no-deps .

ENV DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "cinegraph.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
