#!/bin/bash

set -e  # Exit on any error

# Configuration
IMAGE_NAME="icar-service-backend-jun-9"
IMAGE_TAG="latest_v1.0.1"
TAR_FILE="${IMAGE_NAME}_${IMAGE_TAG}.tar"
SERVER_USER="akshat"
SERVER_HOST="10.128.188.8"
SERVER_PORT="9822"
SERVER_PATH="/home/akshat/"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Cleanup function
cleanup() {
    if [ -f "$TAR_FILE" ]; then
        print_info "Cleaning up temporary file: $TAR_FILE"
        rm -f "$TAR_FILE"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Step 1: Build Docker image
print_info "Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"
if docker build --platform linux/amd64 --no-cache -t "${IMAGE_NAME}:${IMAGE_TAG}" .; then
    print_info "Docker image built successfully"
else
    print_error "Failed to build Docker image"
    exit 1
fi

# Step 2: Save Docker image as tar file
print_info "Saving Docker image to tar file: $TAR_FILE"
if docker save -o "$TAR_FILE" "${IMAGE_NAME}:${IMAGE_TAG}"; then
    print_info "Docker image saved successfully"
    # Get file size for info
    FILE_SIZE=$(du -h "$TAR_FILE" | cut -f1)
    print_info "Tar file size: $FILE_SIZE"
else
    print_error "Failed to save Docker image"
    exit 1
fi

# Step 3: Transfer tar file to server
print_info "Transferring tar file to server..."
print_warning "You will be prompted for the server password"
if scp -P "$SERVER_PORT" "$TAR_FILE" "${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"; then
    print_info "File transferred successfully to ${SERVER_USER}@${SERVER_HOST}:${SERVER_PATH}"
else
    print_error "Failed to transfer file to server"
    exit 1
fi

print_info "Deployment script completed successfully!"

