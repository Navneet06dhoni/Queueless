# @queueless/contracts

Shared type definitions, event schemas, and REST error contract for QueueLess.

## Overview
- Single runtime dependency: Zod.
- Exports versioned domain event schemas with typed TypeScript definitions.
- Exports REST API error response structures for cross-service consistency.
- Includes publisher and consumer event validation helpers.
- Used across all microservices and frontend clients to prevent schema drift.