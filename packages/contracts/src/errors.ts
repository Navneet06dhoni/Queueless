import { z } from 'zod';

/**
 * Standard REST API Error Response Envelope
 */
export const ErrorResponseBodySchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  details: z.any().optional(),
});
export type ApiErrorResponseBody = z.infer<typeof ErrorResponseBodySchema>;

export const ErrorResponseEnvelopeSchema = z.object({
  error: ErrorResponseBodySchema,
});
export type ApiErrorResponse = z.infer<typeof ErrorResponseEnvelopeSchema>;
