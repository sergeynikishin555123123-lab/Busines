FROM node:22-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Создаём директории с правильными правами ДО копирования
RUN mkdir -p /app/data /app/logs /app/uploads && \
    chmod -R 777 /app/data /app/logs /app/uploads

# Копируем package.json сначала (для кэширования)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production && npm cache clean --force

# Копируем остальной код
COPY . .

# Даём права на всё приложение (временное решение для демонстрации)
RUN chmod -R 777 /app

# Создаём непривилегированного пользователя
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Меняем владельца на appuser
RUN chown -R appuser:appgroup /app

# Переключаемся на пользователя appuser
USER appuser

# Экспортируем порт
EXPOSE 8080

# Запуск
CMD ["npm", "start"]
