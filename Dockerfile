FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-pip \
  && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp \
  && apt-get purge -y --auto-remove python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY index.html index.js ./

EXPOSE 3000
CMD ["npm", "start"]
