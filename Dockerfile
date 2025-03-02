# ---- STAGE 1: Build Go Binary ----
FROM python:3.11-slim AS builder

# Set the working directory inside the container
WORKDIR /app

# Install required system packages
RUN apt-get update && \
    apt-get install -y inotify-tools bash gosu curl git gcc g++ make && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Go
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

# Set up Go workspace
ENV GOPATH=/go
ENV PATH="${GOPATH}/bin:${PATH}"

# Copy Go project files and build
COPY WebDavHub /app/WebDavHub
WORKDIR /app/WebDavHub
RUN go mod tidy && go build -o /app/WebDavHub/cinesync

# ---- STAGE 2: Final Lightweight Image ----
FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Install required system packages
RUN apt-get update && \
    apt-get install -y inotify-tools bash gosu && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy the requirements file and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire Python project
COPY MediaHub /app/MediaHub
COPY --from=builder /app/WebDavHub /app/WebDavHub

# Set environment variables for PUID and PGID
ENV PUID=1000
ENV PGID=1000

# Add entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

# Run the application
CMD ["python3", "MediaHub/main.py", "--auto-select"]
