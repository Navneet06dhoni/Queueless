# @queueless/common
Common HTTP, logging, error handling, health, and config utilities for QueueLess services.

## Exported Symbols
createLogger, logger, requestIdMiddleware, requestLogger, ApiError, errorHandler, createHealthRouter, createGracefulShutdown, loadConfig

## Runtime Dependencies
@queueless/contracts, express, pino, pino-http, zod

## Example: const app = express(); app.use(requestIdMiddleware); app.use(createHealthRouter({ serviceName: 'test' }));