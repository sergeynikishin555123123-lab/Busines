FROM node:22-alpine

WORKDIR /app

# Создаём пользователя с UID 2000
RUN addgroup -g 2000 appgroup && adduser -u 2000 -G appgroup -s /bin/sh -D appuser

# Копируем package.json
COPY package*.json ./

RUN npm ci --only=production && npm cache clean --force

# Копируем код
COPY . .

# Создаём директории и даём права
RUN mkdir -p /tmp/data /tmp/logs /tmp/uploads /app/public && \
    chown -R appuser:appgroup /tmp/data /tmp/logs /tmp/uploads /app && \
    chmod -R 777 /tmp/data /tmp/logs /tmp/uploads

# Создаём index.html если нет
RUN echo "<h1>Bot is running!</h1>" > /app/public/index.html

# Меняем владельца всего приложения
RUN chown -R appuser:appgroup /app

# Переключаемся на пользователя
USER appuser

EXPOSE 8080

# Используем exec form для правильной обработки сигналов
CMD ["node", "server.js"]
