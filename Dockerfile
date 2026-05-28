FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p reports

ENV HOST=0.0.0.0
ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
