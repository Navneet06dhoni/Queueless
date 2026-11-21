import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { businessApi } from '../../../api';
import { IBusiness } from '../../../api/types';
import { useToast } from '../../../components/ui/Toast';
import {
  Card,
  Badge,
  Button,
  Input,
  Modal,
} from '../../../components/ui';
import {
  Building,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  Clock,
  Edit,
  Phone,
  MapPin,
} from 'lucide-react';

export const BUSINESS_CATEGORIES = [
  'Salon & Spa',
  'Medical Clinic',
  'Dental Clinic',
  'Automotive & Repair',
  'Government & Municipal',
  'Banking & Financial',
  'Restaurant & Cafe',
  'Retail & Grocery',
  'Other Services',
];

const businessSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(255, 'Max 255 characters'),
  category: z.string().trim().min(2, 'Please select a category'),
  address: z.string().trim().min(3, 'Address must be at least 3 characters'),
  city: z.string().trim().min(2, 'City must be at least 2 characters').max(100),
  phone: z.string().trim().min(8, 'Phone must be at least 8 digits').max(30),
});

type BusinessFormData = z.infer<typeof businessSchema>;

interface BusinessManageTabProps {
  businesses: IBusiness[];
  selectedBusinessId: string | null;
  onSelectBusiness: (id: string) => void;
  refetchBusinesses: () => void;
}

export const BusinessManageTab: React.FC<BusinessManageTabProps> = ({
  businesses,
  selectedBusinessId,
  onSelectBusiness,
  refetchBusinesses,
}) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(businesses.length === 0);
  const [editingBusiness, setEditingBusiness] = useState<IBusiness | null>(null);

  // Form for creation
  const createForm = useForm<BusinessFormData>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      name: '',
      category: BUSINESS_CATEGORIES[0],
      address: '',
      city: '',
      phone: '',
    },
  });

  // Form for editing
  const editForm = useForm<BusinessFormData>({
    resolver: zodResolver(businessSchema),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: BusinessFormData) => businessApi.createBusiness(data),
    onSuccess: (newBusiness) => {
      setIsCreateOpen(false);
      createForm.reset();
      refetchBusinesses();
      onSelectBusiness(newBusiness.id);
      queryClient.invalidateQueries({ queryKey: ['owner-businesses'] });
      toast.success('Business created successfully! It is pending admin approval.');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to create business';
      toast.error(msg);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BusinessFormData> }) =>
      businessApi.updateBusiness(id, data),
    onSuccess: (updated) => {
      setEditingBusiness(null);
      refetchBusinesses();
      queryClient.invalidateQueries({ queryKey: ['owner-businesses'] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', updated.id] });
      toast.success('Business details updated successfully');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to update business';
      toast.error(msg);
    },
  });

  const handleEditClick = (biz: IBusiness) => {
    setEditingBusiness(biz);
    editForm.reset({
      name: biz.name,
      category: biz.category,
      address: biz.address,
      city: biz.city,
      phone: biz.phone,
    });
  };

  const selectedBiz = businesses.find((b) => b.id === selectedBusinessId) || businesses[0];

  return (
    <div className="space-y-8">
      {/* Pending / Rejected Banners for selected business */}
      {selectedBiz && selectedBiz.status === 'pending' && (
        <div
          data-testid="pending-approval-banner"
          className="p-4 sm:p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-3"
        >
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <h4 className="font-bold">Pending Admin Approval</h4>
            <p className="text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
              Your business &quot;{selectedBiz.name}&quot; has been submitted and is awaiting platform administrator review.
              While pending, you can configure your services and working hours, but the business will not be visible in public search.
            </p>
          </div>
        </div>
      )}

      {selectedBiz && selectedBiz.status === 'rejected' && (
        <div
          data-testid="rejected-explanation-banner"
          className="p-4 sm:p-5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <h4 className="font-bold">Business Application Rejected</h4>
            <p className="text-red-800 dark:text-red-300 text-xs sm:text-sm">
              This business listing was reviewed and rejected by the platform administrators.
              Please check your information, address, and phone number, update your details below, or contact support for reconsideration.
            </p>
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-red-700 dark:text-red-300 border-red-300 dark:border-red-800 bg-white dark:bg-red-900/20"
                onClick={() => handleEditClick(selectedBiz)}
              >
                Edit Business Details
              </Button>
            </div>
          </div>
        </div>
      )}

      {selectedBiz && selectedBiz.status === 'approved' && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="text-sm">
            <span className="font-bold">Approved & Active:</span> &quot;{selectedBiz.name}&quot; is live and discoverable in the directory.
          </div>
        </div>
      )}

      {/* Top Bar: Business list with status badges & Add Business button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Your Businesses ({businesses.length})
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Select a business to configure its details, services, hours and slots.
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5"
        >
          <PlusCircle className="w-4 h-4" /> Register New Business
        </Button>
      </div>

      {/* Business Cards Grid */}
      {businesses.length === 0 ? (
        <Card className="p-8 text-center space-y-4">
          <Building className="w-12 h-12 mx-auto text-gray-400" />
          <div className="space-y-1">
            <h4 className="text-lg font-bold text-gray-900 dark:text-white">No businesses registered yet</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              Get started by creating your first business profile to manage slots and live virtual queues.
            </p>
          </div>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
            Create Business Profile
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {businesses.map((biz) => {
            const isSelected = biz.id === (selectedBiz?.id || selectedBusinessId);
            return (
              <Card
                key={biz.id}
                className={`p-5 transition-all cursor-pointer relative ${
                  isSelected
                    ? 'border-2 border-primary-500 shadow-md ring-2 ring-primary-500/20'
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300'
                }`}
                onClick={() => onSelectBusiness(biz.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                      {biz.category}
                    </span>
                    <h4 className="text-base font-bold text-gray-900 dark:text-white mt-0.5">
                      {biz.name}
                    </h4>
                  </div>
                  <Badge
                    variant={
                      biz.status === 'approved'
                        ? 'success'
                        : biz.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                    }
                    size="sm"
                    className="capitalize font-bold"
                  >
                    {biz.status}
                  </Badge>
                </div>

                <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{biz.address}, {biz.city}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 shrink-0" />
                    <span>{biz.phone}</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    {isSelected ? '✓ Currently selected' : 'Click to select'}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs py-1 px-2.5 h-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditClick(biz);
                    }}
                  >
                    <Edit className="w-3 h-3 mr-1" /> Edit
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Business Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Register New Business"
        description="Fill in your business details. After creation, your profile will be submitted for admin approval."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={createMutation.isPending}
              disabled={createMutation.isPending}
              onClick={createForm.handleSubmit((data) => createMutation.mutate(data))}
            >
              Submit for Approval
            </Button>
          </>
        }
      >
        <form
          data-testid="create-business-form"
          className="space-y-4"
          onSubmit={createForm.handleSubmit((data) => createMutation.mutate(data))}
        >
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="biz-name">
              Business Name *
            </label>
            <Input
              id="biz-name"
              placeholder="e.g. Apollo Wellness Clinic"
              {...createForm.register('name')}
              error={createForm.formState.errors.name?.message}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="biz-category">
              Category *
            </label>
            <select
              id="biz-category"
              {...createForm.register('category')}
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {BUSINESS_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            {createForm.formState.errors.category?.message && (
              <p className="mt-1 text-xs text-red-500">{createForm.formState.errors.category.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="biz-address">
              Street Address *
            </label>
            <Input
              id="biz-address"
              placeholder="e.g. 104 MG Road, Indiranagar"
              {...createForm.register('address')}
              error={createForm.formState.errors.address?.message}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="biz-city">
                City *
              </label>
              <Input
                id="biz-city"
                placeholder="e.g. Bangalore"
                {...createForm.register('city')}
                error={createForm.formState.errors.city?.message}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="biz-phone">
                Phone Number *
              </label>
              <Input
                id="biz-phone"
                placeholder="e.g. +91 9876543210"
                {...createForm.register('phone')}
                error={createForm.formState.errors.phone?.message}
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Edit Business Modal */}
      <Modal
        isOpen={!!editingBusiness}
        onClose={() => setEditingBusiness(null)}
        title="Edit Business Details"
        description={`Update contact and address information for ${editingBusiness?.name}`}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditingBusiness(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={updateMutation.isPending}
              disabled={updateMutation.isPending}
              onClick={editForm.handleSubmit((data) => {
                if (editingBusiness) {
                  updateMutation.mutate({ id: editingBusiness.id, data });
                }
              })}
            >
              Save Changes
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={editForm.handleSubmit((data) => {
            if (editingBusiness) {
              updateMutation.mutate({ id: editingBusiness.id, data });
            }
          })}
        >
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="edit-name">
              Business Name *
            </label>
            <Input
              id="edit-name"
              {...editForm.register('name')}
              error={editForm.formState.errors.name?.message}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="edit-category">
              Category *
            </label>
            <select
              id="edit-category"
              {...editForm.register('category')}
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {BUSINESS_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="edit-address">
              Street Address *
            </label>
            <Input
              id="edit-address"
              {...editForm.register('address')}
              error={editForm.formState.errors.address?.message}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="edit-city">
                City *
              </label>
              <Input
                id="edit-city"
                {...editForm.register('city')}
                error={editForm.formState.errors.city?.message}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="edit-phone">
                Phone Number *
              </label>
              <Input
                id="edit-phone"
                {...editForm.register('phone')}
                error={editForm.formState.errors.phone?.message}
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
