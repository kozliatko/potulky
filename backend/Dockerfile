FROM node:20-alpine

WORKDIR /app

# Inštalácia závislostí (oddelene pre lepší Docker cache)
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

# Bezpečnosť — nespúšťaj ako root
USER node

EXPOSE 3001

CMD ["node", "server.js"]
