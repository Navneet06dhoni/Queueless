import {
  BookingConfirmedEventSchema,
  validateEventPublish,
  validateEventConsume,
  ErrorResponseEnvelopeSchema,
} from '../src';

describe('@queueless/contracts', () => {
  it('validates a valid booking.confirmed event publish', () => {
    const raw = {
      appointmentId: '11111111-1111-1111-1111-111111111111',
      customerId: '22222222-2222-2222-2222-222222222222',
      customerName: 'Test User',
      slotStartTime: new Date('2026-11-25T10:00:00Z'),
    };
    const validated = validateEventPublish('booking.confirmed', raw);
    expect(validated.v).toBe(1);
    expect(validated.appointmentId).toBe(raw.appointmentId);
    expect(typeof validated.slotStartTime).toBe('string');
  });

  it('rejects an invalid booking.confirmed event on consume', () => {
    expect(() => {
      validateEventConsume('booking.confirmed', { v: 1, appointmentId: 'not-a-uuid' });
    }).toThrow();
  });

  it('validates the REST error response envelope schema', () => {
    const errorBody = {
      error: {
        code: 'NOT_FOUND',
        message: 'Business not found',
        requestId: 'test-req-123',
      },
    };
    const parsed = ErrorResponseEnvelopeSchema.parse(errorBody);
    expect(parsed.error.code).toBe('NOT_FOUND');
    expect(parsed.error.requestId).toBe('test-req-123');
  });
});
