# Notification Service
Standalone notification microservice for QueueLess.

## Exported Capabilities
In-app notifications API, email dispatch with exponential retries, event consumption from RabbitMQ, real-time push events.

## Runtime Dependencies
@queueless/common, @queueless/contracts, @queueless/messaging, express, pg, amqplib, nodemailer, zod.

## Local Execution: `npm run dev` or `docker compose up notification-service`