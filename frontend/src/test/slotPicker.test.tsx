import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BusinessDetailPage } from '../pages/BusinessDetailPage';
import * as apiModule from '../api';
import * as AuthContextModule from '../context/AuthContext';
import { ToastProvider } from '../components/ui/Toast';

describe('Slot Picker & Booking flow in BusinessDetailPage', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const mockBusiness = {
    id: 'b1',
    owner_id: 'o1',
    name: 'Apollo Dental',
    category: 'clinic',
    address: '101 Indiranagar',
    city: 'Bengaluru',
    phone: '+919876543210',
    status: 'approved' as const,
    created_at: new Date().toISOString(),
    services: [
      {
        id: 's1',
        business_id: 'b1',
        name: 'Teeth Cleaning',
        duration_minutes: 30,
        price: 500,
        created_at: new Date().toISOString(),
      },
    ],
    working_hours: [
      { day_of_week: 5, open_time: '09:00', close_time: '17:00' },
    ],
  };

  const mockSlots = [
    {
      id: 'slot-free-1',
      service_id: 's1',
      // 04:30 UTC = 10:00 AM IST
      start_time: '2026-11-20T04:30:00.000Z',
      end_time: '2026-11-20T05:00:00.000Z',
      status: 'free' as const,
    },
    {
      id: 'slot-booked-2',
      service_id: 's1',
      // 05:00 UTC = 10:30 AM IST
      start_time: '2026-11-20T05:00:00.000Z',
      end_time: '2026-11-20T05:30:00.000Z',
      status: 'booked' as const,
    },
  ];

  beforeEach(() => {
    queryClient.clear();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'c1',
        name: 'Priya Customer',
        email: 'priya@test.com',
        role: 'customer',
        created_at: '',
      },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    vi.spyOn(apiModule.businessApi, 'getBusinessDetail').mockResolvedValue(mockBusiness);
    vi.spyOn(apiModule.businessApi, 'getSlots').mockResolvedValue(mockSlots);
  });

  it('renders IST times from UTC input and disables non-free slots', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/businesses/b1']}>
            <Routes>
              <Route path="/businesses/:id" element={<BusinessDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    // Business name rendered
    expect(await screen.findByText('Apollo Dental')).toBeInTheDocument();

    // 04:30 UTC rendered as 10:00 AM IST
    const freeSlotButton = await screen.findByRole('button', { name: /10:00 AM/i });
    expect(freeSlotButton).toBeInTheDocument();
    expect(freeSlotButton).toBeEnabled();

    // 05:00 UTC rendered as 10:30 AM IST and disabled because status is booked
    const bookedSlotButton = await screen.findByRole('button', { name: /10:30 AM/i });
    expect(bookedSlotButton).toBeInTheDocument();
    expect(bookedSlotButton).toBeDisabled();
    expect(bookedSlotButton).toHaveTextContent(/Booked/i);
  });

  it('refetches slots and shows friendly error on 409 slot taken', async () => {
    const getSlotsSpy = vi.spyOn(apiModule.businessApi, 'getSlots').mockResolvedValue(mockSlots);

    // Mock book appointment 409 Conflict
    vi.spyOn(apiModule.bookingApi, 'bookAppointment').mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: {
            code: 'SLOT_ALREADY_BOOKED',
            message: 'Slot is already booked',
          },
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/businesses/b1']}>
            <Routes>
              <Route path="/businesses/:id" element={<BusinessDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    // Click free slot
    const freeSlotButton = await screen.findByRole('button', { name: /10:00 AM/i });
    fireEvent.click(freeSlotButton);

    // Modal opens
    const confirmButton = await screen.findByRole('button', { name: /confirm booking/i });
    expect(confirmButton).toBeInTheDocument();

    // Clear initial fetch calls
    getSlotsSpy.mockClear();

    // Click confirm booking
    fireEvent.click(confirmButton);

    // Error banner appears
    await waitFor(() => {
      expect(
        screen.getByText(/This slot was just booked by another customer/i)
      ).toBeInTheDocument();
    });

    // Slots were refetched
    expect(getSlotsSpy).toHaveBeenCalled();
  });
});
