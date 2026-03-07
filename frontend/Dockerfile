FROM node:22-alpine

WORKDIR /app

# Install dependencies at build time (Linux-compatible binaries)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

EXPOSE 3000

CMD ["npm", "run", "dev"]
