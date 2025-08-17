#!/bin/bash

# Redis Integration Test Setup Script
echo "🐳 Setting up Redis for integration tests..."

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Stop and remove existing Redis container if it exists
echo "🧹 Cleaning up existing Redis container..."
docker stop redis-test >/dev/null 2>&1 || true
docker rm redis-test >/dev/null 2>&1 || true

# Start Redis container
echo "🚀 Starting Redis container..."
docker run -d \
    --name redis-test \
    -p 6379:6379 \
    redis:alpine

# Wait for Redis to be ready
echo "⏳ Waiting for Redis to be ready..."
sleep 2

# Test Redis connection
if docker exec redis-test redis-cli ping >/dev/null 2>&1; then
    echo "✅ Redis is ready for integration tests!"
    echo ""
    echo "📋 Container details:"
    echo "   Name: redis-test"
    echo "   Port: 6379"
    echo "   Image: redis:alpine"
    echo ""
    echo "🧪 You can now run the tests:"
    echo "   npm test -- --testPathPattern=redis-cache-integration"
    echo ""
    echo "🛑 To stop Redis when done:"
    echo "   docker stop redis-test && docker rm redis-test"
else
    echo "❌ Redis failed to start properly"
    exit 1
fi
