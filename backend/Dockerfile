FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY models ./models
COPY openapi.json ./
USER node
EXPOSE 3000
CMD ["npm", "start"]
