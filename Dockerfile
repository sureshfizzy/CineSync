# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Install inotify-tools and bash
RUN apt-get update && \
    apt-get install -y inotify-tools bash && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy the requirements file and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project to the container's working directory
COPY MediaHub /app/MediaHub
COPY .env ./

# Set PYTHONPATH to include the MediaHub directory
ENV PYTHONPATH=/app/MediaHub

# Set environment variables from the .env file
RUN export $(grep -v '^#' .env | xargs -d '\n' -I {} echo "ENV {}")

# Add entrypoint to ensure bash is available
ENTRYPOINT ["/bin/bash", "-c"]

# Run the application
CMD ["python3 MediaHub/main.py --auto-select"]
