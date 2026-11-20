import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BusinessSearchPage } from '../pages/BusinessSearchPage';
import * as apiModule from '../api';

describe('Search URL Sync in BusinessSearchPage', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const LocationDisplay = () => {
    const location = useLocation();
    return <div data-testid="location-display">{location.search}</div>;
  };

  it('changing a category filter updates the query string and resets page to 1', async () => {
    vi.spyOn(apiModule.businessApi, 'getApprovedBusinesses').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 9,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/businesses?page=3']}>
          <Routes>
            <Route
              path="/businesses"
              element={
                <>
                  <BusinessSearchPage />
                  <LocationDisplay />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const select = screen.getByRole('combobox', { name: /filter by category/i });
    fireEvent.change(select, { target: { value: 'clinic' } });

    await waitFor(() => {
      const loc = screen.getByTestId('location-display');
      expect(loc.textContent).toContain('category=clinic');
      expect(loc.textContent).toContain('page=1');
    });
  });

  it('typing in city filter updates the query string', async () => {
    vi.spyOn(apiModule.businessApi, 'getApprovedBusinesses').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 9,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/businesses']}>
          <Routes>
            <Route
              path="/businesses"
              element={
                <>
                  <BusinessSearchPage />
                  <LocationDisplay />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const cityInput = screen.getByPlaceholderText(/filter city/i);
    fireEvent.change(cityInput, { target: { value: 'Bengaluru' } });

    await waitFor(() => {
      const loc = screen.getByTestId('location-display');
      expect(loc.textContent).toContain('city=Bengaluru');
    });
  });
});
