# ---- STAGE 1: Build WebDavHub ----
FROM python:3.11-slim AS builder

# Set the working directory inside the container
WORKDIR /app

# Install build dependencies
RUN apt-get update && \
    apt-get install -y inotify-tools bash curl git gcc g++ make && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Go (Dynamic architecture detection)
ENV GO_VERSION=1.21.0
RUN ARCH=$(dpkg --print-architecture) && \
    case "$ARCH" in \
      amd64) GOARCH="linux-amd64";; \
      arm64) GOARCH="linux-arm64";; \
      armhf) GOARCH="linux-armv6l";; \
      *) echo "Unsupported architecture: $ARCH"; exit 1;; \
    esac && \
    curl -fsSL https://go.dev/dl/go${GO_VERSION}.${GOARCH}.tar.gz | tar -C /usr/local -xz

ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH=/go
ENV PATH="${GOPATH}/bin:${PATH}"

# Install pnpm globally
RUN npm install -g pnpm

# Copy WebDavHub and build
COPY WebDavHub /app/WebDavHub
WORKDIR /app/WebDavHub

# Build using the production build script
RUN python3 scripts/build-prod.py

# ---- STAGE 2: Final Runtime Image ----
FROM python:3.11-slim

# Install required system packages
RUN apt-get update && \
    apt-get install -y inotify-tools bash gosu curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

# Copy Python dependencies and install
COPY requirements.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Set default PUID and PGID
ENV PUID=1000
ENV PGID=1000

# Create default user and group
RUN groupadd -g ${PGID} appuser && \
    useradd -u ${PUID} -g appuser -d /app -s /bin/bash appuser

# Copy application files
COPY MediaHub /app/MediaHub
COPY --from=builder /app/WebDavHub /app/WebDavHub

# Add the entrypoint script
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

# Set working directory
WORKDIR /app

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["python3", "WebDavHub/scripts/start-prod.py"]
