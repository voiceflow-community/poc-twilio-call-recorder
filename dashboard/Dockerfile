FROM node:20.11.0-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm install && \
    npm install -D @types/express @types/node @types/ws && \
    apk del python3 make g++

# Copy source code
COPY . .

# Build both server and Next.js application
RUN npm run build

# Expose ports for Next.js and WebSocket server
EXPOSE 3000 3902

# Start both Next.js and server in production mode
CMD ["npm", "run", "start"]
