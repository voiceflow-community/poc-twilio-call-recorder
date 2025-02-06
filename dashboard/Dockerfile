FROM node:20.11.0-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache python3 make g++

# Install npm dependencies first (better caching)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose ports
EXPOSE 3000 3902

# Start the application
CMD ["npm", "run", "dev"]
