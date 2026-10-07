FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh","-c","node server/index.js & API_PID=$!; if [ -n \"$STEAM_USERNAME\" ] && [ -n \"$STEAM_PASSWORD\" ]; then exec node bot/index.js; else echo 'Steam credentials not configured; API-only mode'; wait $API_PID; fi"]
