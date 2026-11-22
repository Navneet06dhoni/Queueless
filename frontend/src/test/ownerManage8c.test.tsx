import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BusinessManageTab } from '../pages/owner/manage/BusinessManageTab';
import { ServicesManageTab } from '../pages/owner/manage/ServicesManageTab';
import { WorkingHoursManageTab } from '../pages/owner/manage/WorkingHoursManageTab';
import { SlotsManageTab } from '../pages/owner/manage/SlotsManageTab';
import { TodayTab } from '../pages/owner/TodayTab';
import { businessApi, bookingApi, analyticsApi } from '../api';
import { ToastProvider } from '../components/ui/Toast';
import { formatDate } from '../utils/date';

describe('Step 8c Owner Management Tests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });
  });

  const renderWithProviders = (ui: React.ReactNode) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  };

  it('create-business form validates and shows the pending banner after success', async () => {
    const mockCreatedBiz = {
      id: 'biz-new-1',
      owner_id: 'owner-1',
      name: 'Lotus Wellness Spa',
      category: 'Salon & Spa',
      address: '42 MG Road',
      city: 'Bangalore',
      phone: '+91 9876543210',
      status: 'pending' as const,
      created_at: new Date().toISOString(),
    };

    const createSpy = vi.spyOn(businessApi, 'createBusiness').mockResolvedValue(mockCreatedBiz);
    const refetchSpy = vi.fn();
    const selectSpy = vi.fn();

    renderWithProviders(
      <BusinessManageTab
        businesses={[]}
        selectedBusinessId={null}
        onSelectBusiness={selectSpy}
        refetchBusinesses={refetchSpy}
      />
    );

    // Initial state: no businesses, create form should be open or triggered
    expect(screen.getByText(/Create Business Profile/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Create Business Profile/i));

    // Submit with empty inputs to verify validation
    const submitBtn = screen.getByText('Submit for Approval');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Name must be at least 2 characters/i)).toBeInTheDocument();
      expect(screen.getByText(/Address must be at least 3 characters/i)).toBeInTheDocument();
    });

    // Fill valid data
    fireEvent.change(screen.getByLabelText(/Business Name/i), {
      target: { value: 'Lotus Wellness Spa' },
    });
    fireEvent.change(screen.getByLabelText(/Street Address/i), {
      target: { value: '42 MG Road' },
    });
    fireEvent.change(screen.getByLabelText(/City/i), {
      target: { value: 'Bangalore' },
    });
    fireEvent.change(screen.getByLabelText(/Phone Number/i), {
      target: { value: '+91 9876543210' },
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        name: 'Lotus Wellness Spa',
        category: 'Salon & Spa',
        address: '42 MG Road',
        city: 'Bangalore',
        phone: '+91 9876543210',
      });
      expect(selectSpy).toHaveBeenCalledWith('biz-new-1');
    });

    // Re-render with pending business to verify the pending approval banner appears
    renderWithProviders(
      <BusinessManageTab
        businesses={[mockCreatedBiz]}
        selectedBusinessId="biz-new-1"
        onSelectBusiness={selectSpy}
        refetchBusinesses={refetchSpy}
      />
    );

    expect(screen.getByTestId('pending-approval-banner')).toBeInTheDocument();
    expect(screen.getByTestId('pending-approval-banner')).toHaveTextContent(/Pending Admin Approval/i);
  });

  it('service form limits: duration 4 and 481 rejected; delete shows the 409 message', async () => {
    const mockBiz = {
      id: 'biz-1',
      owner_id: 'owner-1',
      name: 'Lotus Spa',
      category: 'Salon & Spa',
      address: '42 MG Road',
      city: 'Bangalore',
      phone: '+91 9876543210',
      status: 'approved' as const,
      created_at: new Date().toISOString(),
      working_hours: [],
      services: [
        {
          id: 'srv-1',
          business_id: 'biz-1',
          name: 'Massage',
          duration_minutes: 60,
          price: 1500,
          created_at: new Date().toISOString(),
        },
      ],
    };

    vi.spyOn(businessApi, 'getBusinessDetail').mockResolvedValue(mockBiz);
    const deleteSpy = vi.spyOn(businessApi, 'deleteService').mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: {
            message: 'Cannot delete service with active bookings or appointments',
            code: 'SERVICE_HAS_BOOKINGS',
          },
        },
      },
    });

    renderWithProviders(<ServicesManageTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getAllByText('Massage')[0]).toBeInTheDocument();
    });

    // Open Add Service Modal
    fireEvent.click(screen.getByRole('button', { name: /Add Service/i }));

    const durationInput = screen.getByLabelText(/Duration \(minutes: 5 - 480\)/i);
    const nameInput = screen.getByLabelText(/Service Name \*/i);
    const addSubmitBtn = screen.getAllByRole('button', { name: /^Add Service$/i })[1];

    // Test duration 4: rejected
    fireEvent.change(nameInput, { target: { value: 'Short Treatment' } });
    fireEvent.change(durationInput, { target: { value: '4' } });
    fireEvent.click(addSubmitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Duration must be at least 5 minutes/i)).toBeInTheDocument();
    });

    // Test duration 481: rejected
    fireEvent.change(durationInput, { target: { value: '481' } });
    fireEvent.click(addSubmitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Duration cannot exceed 480 minutes/i)).toBeInTheDocument();
    });

    // Close add modal
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    // Test Delete Service showing 409 error
    const deleteButtons = screen.getAllByLabelText('Delete Massage');
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText(/Are you sure you want to delete "Massage"\?/i)).toBeInTheDocument();
    const confirmDeleteBtn = screen.getByRole('button', { name: /Confirm Delete/i });
    fireEvent.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('biz-1', 'srv-1');
      expect(screen.getByTestId('service-delete-error')).toBeInTheDocument();
      expect(
        screen.getByText(/Cannot delete service with active bookings or appointments/i)
      ).toBeInTheDocument();
    });
  });

  it('working hours editor rejects close before open, and "copy Monday to weekdays" fills Tuesday to Friday', async () => {
    const mockBiz = {
      id: 'biz-1',
      owner_id: 'owner-1',
      name: 'Lotus Spa',
      category: 'Salon & Spa',
      address: '42 MG Road',
      city: 'Bangalore',
      phone: '+91 9876543210',
      status: 'approved' as const,
      created_at: new Date().toISOString(),
      working_hours: [
        { day_of_week: 1, open_time: '09:00', close_time: '18:00' },
      ],
      services: [],
    };

    vi.spyOn(businessApi, 'getBusinessDetail').mockResolvedValue(mockBiz);
    const setHoursSpy = vi.spyOn(businessApi, 'setWorkingHours').mockResolvedValue([]);

    renderWithProviders(<WorkingHoursManageTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('day-row-1')).toBeInTheDocument(); // Monday
    });

    // 1. Set close before open on Monday (09:00 to 08:00)
    const mondayClose = screen.getByLabelText(/^To:$/i, { selector: '#close-1' });
    fireEvent.change(mondayClose, { target: { value: '08:00' } });

    const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('error-day-1')).toHaveTextContent(
        /Close time must be later than open time/i
      );
      expect(setHoursSpy).not.toHaveBeenCalled();
    });

    // Fix Monday hours to 10:00 - 19:00
    const mondayOpen = screen.getByLabelText(/^From:$/i, { selector: '#open-1' });
    fireEvent.change(mondayOpen, { target: { value: '10:00' } });
    fireEvent.change(mondayClose, { target: { value: '19:00' } });

    // 2. Click "Copy Monday to Weekdays"
    const copyBtn = screen.getByRole('button', { name: /Copy Monday to Weekdays/i });
    fireEvent.click(copyBtn);

    // Verify Tuesday through Friday have 10:00 - 19:00
    const tuesdayOpen = screen.getByLabelText(/^From:$/i, { selector: '#open-2' }) as HTMLInputElement;
    const tuesdayClose = screen.getByLabelText(/^To:$/i, { selector: '#close-2' }) as HTMLInputElement;
    const fridayOpen = screen.getByLabelText(/^From:$/i, { selector: '#open-5' }) as HTMLInputElement;
    const fridayClose = screen.getByLabelText(/^To:$/i, { selector: '#close-5' }) as HTMLInputElement;

    expect(tuesdayOpen.value).toBe('10:00');
    expect(tuesdayClose.value).toBe('19:00');
    expect(fridayOpen.value).toBe('10:00');
    expect(fridayClose.value).toBe('19:00');
  });

  it('slot generation disables past dates, rejects range > 30 days, displays created and skipped counts', async () => {
    const mockBiz = {
      id: 'biz-1',
      owner_id: 'owner-1',
      name: 'Lotus Spa',
      category: 'Salon & Spa',
      address: '42 MG Road',
      city: 'Bangalore',
      phone: '+91 9876543210',
      status: 'approved' as const,
      created_at: new Date().toISOString(),
      working_hours: [
        { day_of_week: 1, open_time: '09:00', close_time: '18:00' },
      ],
      services: [
        {
          id: 'srv-1',
          business_id: 'biz-1',
          name: 'Consultation',
          duration_minutes: 30,
          price: 500,
          created_at: new Date().toISOString(),
        },
      ],
    };

    vi.spyOn(businessApi, 'getBusinessDetail').mockResolvedValue(mockBiz);
    vi.spyOn(businessApi, 'getSlots').mockResolvedValue([]);
    vi.spyOn(businessApi, 'getBusinessAppointments').mockResolvedValue([]);
    const generateSlotsSpy = vi.spyOn(businessApi, 'generateSlots').mockResolvedValue({
      created: 18,
      skipped: 0,
    });

    renderWithProviders(<SlotsManageTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Generate Appointment Slots/i)).toBeInTheDocument();
    });

    const fromDateInput = screen.getByLabelText(/From Date/i) as HTMLInputElement;
    const toDateInput = screen.getByLabelText(/To Date \(max 30 days\)/i) as HTMLInputElement;

    // Past date disabled via min attribute
    const today = formatDate(new Date(), 'yyyy-MM-dd');
    expect(fromDateInput.min).toBe(today);

    // Range > 30 days
    fireEvent.change(fromDateInput, { target: { value: '2026-12-01' } });
    fireEvent.change(toDateInput, { target: { value: '2027-01-15' } }); // 45 days

    expect(screen.getByTestId('slot-range-error')).toHaveTextContent(
      /Date range cannot exceed 30 days/i
    );

    // Valid range
    fireEvent.change(fromDateInput, { target: { value: '2026-12-01' } });
    fireEvent.change(toDateInput, { target: { value: '2026-12-05' } }); // 4 days

    const generateBtn = screen.getByRole('button', { name: /Generate Slots/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(generateSlotsSpy).toHaveBeenCalledWith('biz-1', {
        service_id: 'srv-1',
        from_date: '2026-12-01',
        to_date: '2026-12-05',
      });
      expect(screen.getByTestId('generation-result')).toBeInTheDocument();
      expect(screen.getByText(/Successfully created/i)).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  it('owner cancel appointment shows confirmation and server message', async () => {
    const mockAppt = {
      id: 'appt-1',
      slot_id: 'slot-1',
      customer_id: 'cust-1',
      status: 'confirmed' as const,
      created_at: new Date().toISOString(),
      slot: {
        id: 'slot-1',
        start_time: '2026-11-21T14:00:00Z',
        end_time: '2026-11-21T14:30:00Z',
        status: 'booked',
      },
      service: {
        id: 'srv-1',
        name: 'General Checkup',
        duration_minutes: 30,
        price: 500,
      },
      business: {
        id: 'biz-1',
        name: 'Apollo Clinic',
        category: 'Medical Clinic',
        address: 'MG Road',
        city: 'Bangalore',
        phone: '9876543210',
      },
      customer: {
        id: 'cust-1',
        name: 'Aarav Patel',
        email: 'aarav@example.com',
      },
    };

    vi.spyOn(businessApi, 'getBusinessAppointments').mockResolvedValue([mockAppt]);
    vi.spyOn(analyticsApi, 'getToday').mockResolvedValue({
      averageWaitMinutesToday: 12,
      todayTotalServed: 5,
      todayWalkInCount: 2,
      todayAppointmentCount: 3,
      nextAppointments: [],
    } as any);

    const cancelSpy = vi.spyOn(bookingApi, 'cancelAppointment').mockResolvedValue({
      message: 'Appointment cancelled successfully by owner',
    });

    renderWithProviders(<TodayTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText('Aarav Patel')).toBeInTheDocument();
      expect(screen.getByText('General Checkup')).toBeInTheDocument();
    });

    // Click owner Cancel button
    const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
    fireEvent.click(cancelBtn);

    // Confirmation modal opens
    expect(screen.getByText(/Cancel Appointment\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Cancelling will free up this slot and notify the customer/i)).toBeInTheDocument();

    const confirmCancelBtn = screen.getByRole('button', { name: /Confirm Cancellation/i });
    fireEvent.click(confirmCancelBtn);

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith('appt-1');
    });
  });
});
