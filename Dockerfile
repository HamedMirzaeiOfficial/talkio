# Standalone server image (Django + Channels via Daphne). Build from the repository root:
#   docker build -t talkio-server .
FROM python:3.12-slim AS server

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# The reusable package is installed from source exactly as the requirements reference it.
COPY packages/django-chat packages/django-chat
COPY apps/server/requirements.txt apps/server/requirements.txt
RUN pip install -r apps/server/requirements.txt

COPY apps/server apps/server
# Documentation shown to staff at /admin/docs/
COPY README.md README.md
COPY docs docs
WORKDIR /app/apps/server
RUN useradd --create-home --uid 10001 talkio && mkdir -p media private_media staticfiles && chown -R talkio /app/apps/server
USER talkio

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health/')"
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "core.asgi:application"]
