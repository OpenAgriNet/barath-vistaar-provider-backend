FROM node:20.0.0

WORKDIR /app

# Install curl for weather API calls
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Install dependencies (separate RUN avoids npm "Exit handler never called" with cache + native rebuild)
RUN --mount=type=cache,target=/root/.npm \
    npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 60000 \
    && npm install --no-audit --no-fund

# Rebuild bcrypt for container arch (in a separate process so npm exits cleanly)
RUN npm rebuild bcrypt --build-from-source

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
