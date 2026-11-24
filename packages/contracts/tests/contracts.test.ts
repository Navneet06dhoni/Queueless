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

  it('validates both shapes of queue.joined (with and without customerName/customerEmail)', () => {
    // Old shape (without customerName/customerEmail)
    const oldShape = {
      v: 1,
      businessId: '11111111-1111-1111-1111-111111111111',
      customerId: '22222222-2222-2222-2222-222222222222',
      ticketNumber: 5,
      position: 1,
    };
    const validatedOld = validateEventConsume('queue.joined', oldShape);
    expect(validatedOld.ticketNumber).toBe(5);
    expect(validatedOld.customerName).toBeUndefined();

    // New shape (with customerName and customerEmail)
    const newShape = {
      v: 1,
      businessId: '11111111-1111-1111-1111-111111111111',
      customerId: '22222222-2222-2222-2222-222222222222',
      customerName: 'Alice Customer',
      customerEmail: 'alice@example.com',
      ticketNumber: 5,
      position: 1,
    };
    const validatedNew = validateEventConsume('queue.joined', newShape);
    expect(validatedNew.customerName).toBe('Alice Customer');
    expect(validatedNew.customerEmail).toBe('alice@example.com');
  });

  it('validates both shapes of queue.advanced (with and without customerName/customerEmail)', () => {
    // Old shape
    const oldShape = {
      v: 1,
      businessId: '11111111-1111-1111-1111-111111111111',
      calledEntryId: '33333333-3333-3333-3333-333333333333',
      calledCustomerId: '22222222-2222-2222-2222-222222222222',
    };
    const validatedOld = validateEventConsume('queue.advanced', oldShape);
    expect(validatedOld.calledCustomerId).toBe(oldShape.calledCustomerId);

    // New shape
    const newShape = {
      v: 1,
      businessId: '11111111-1111-1111-1111-111111111111',
      calledEntryId: '33333333-3333-3333-3333-333333333333',
      calledCustomerId: '22222222-2222-2222-2222-222222222222',
      calledCustomerName: 'Alice Customer',
      calledCustomerEmail: 'alice@example.com',
      customerName: 'Alice Customer',
      customerEmail: 'alice@example.com',
    };
    const validatedNew = validateEventConsume('queue.advanced', newShape);
    expect(validatedNew.customerName).toBe('Alice Customer');
    expect(validatedNew.customerEmail).toBe('alice@example.com');
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
