FROM node:22-alpine

# Создаём пользователя node с правильными правами
RUN addgroup -S node && adduser -S node -G node

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Копируем исходный код
COPY --chown=node:node . .

# Создаём необходимые директории с правильными правами
RUN mkdir -p data logs uploads && \
    chown -R node:node data logs uploads && \
    chmod -R 777 data logs uploads

# Переключаемся на пользователя node
USER node

# Экспортируем порт
EXPOSE 8080

# Запуск
CMD ["npm", "start"]
