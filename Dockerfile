FROM node:22-alpine

WORKDIR /app

# Устанавливаем зависимости
COPY package*.json ./
RUN npm ci --only=production

# Копируем код
COPY . .

# Создаем директории для данных
RUN mkdir -p /app/data /app/uploads /app/logs

# Пользователь node
USER node

EXPOSE 8080

CMD ["npm", "start"]
