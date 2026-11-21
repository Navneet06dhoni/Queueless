import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { businessApi } from '../../../api';
import { IService } from '../../../api/types';
import { useToast } from '../../../components/ui/Toast';
import {
  Card,
  Button,
  Input,
  Modal,
  Skeleton,
  EmptyState,
} from '../../../components/ui';
import {
  PlusCircle,
  Scissors,
  Edit,
  Trash2,
  Clock,
  AlertCircle,
} from 'lucide-react';

const serviceSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(255, 'Max 255 characters'),
  duration_minutes: z.coerce
    .number()
    .int('Duration must be a whole number')
    .min(5, 'Duration must be at least 5 minutes')
    .max(480, 'Duration cannot exceed 480 minutes (8 hours)'),
  price: z.coerce
    .number()
    .min(0, 'Price must be greater than or equal to 0'),
});

interface ServiceFormData {
  name: string;
  duration_minutes: number;
  price: number;
}

interface ServicesManageTabProps {
  businessId: string;
}

export const ServicesManageTab: React.FC<ServicesManageTabProps> = ({ businessId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingService, setEditingService] = useState<IService | null>(null);
  const [deletingService, setDeletingService] = useState<IService | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch business detail to get services
  const { data: business, isLoading } = useQuery({
    queryKey: ['business-detail', businessId],
    queryFn: () => businessApi.getBusinessDetail(businessId),
    enabled: !!businessId,
  });

  const services = business?.services || [];

  // Form for add
  const addForm = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema) as any,
    defaultValues: {
      name: '',
      duration_minutes: 30,
      price: 0,
    },
  });

  // Form for edit
  const editForm = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema) as any,
  });

  // Add mutation
  const addMutation = useMutation({
    mutationFn: (data: ServiceFormData) => businessApi.addService(businessId, data),
    onSuccess: (newService) => {
      setIsAddOpen(false);
      addForm.reset({ name: '', duration_minutes: 30, price: 0 });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      toast.success(`Service "${newService.name}" created successfully`);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to add service';
      toast.error(msg);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ serviceId, data }: { serviceId: string; data: Partial<ServiceFormData> }) =>
      businessApi.updateService(businessId, serviceId, data),
    onSuccess: (updated) => {
      setEditingService(null);
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      toast.success(`Service "${updated.name}" updated successfully`);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to update service';
      toast.error(msg);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (serviceId: string) => businessApi.deleteService(businessId, serviceId),
    onSuccess: (res) => {
      setDeletingService(null);
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      toast.success(res.message || 'Service deleted successfully');
    },
    onError: (err: any) => {
      const msg =
        err.response?.data?.error?.message ||
        'Cannot delete service with active bookings or appointments';
      setDeleteError(msg);
    },
  });

  const handleEditClick = (srv: IService) => {
    setEditingService(srv);
    editForm.reset({
      name: srv.name,
      duration_minutes: srv.duration_minutes,
      price: srv.price,
    });
  };

  const handleDeleteClick = (srv: IService) => {
    setDeleteError(null);
    setDeletingService(srv);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Offered Services ({services.length})
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Define durations and pricing for appointments and queue services.
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            addForm.reset({ name: '', duration_minutes: 30, price: 0 });
            setIsAddOpen(true);
          }}
          className="flex items-center gap-1.5"
        >
          <PlusCircle className="w-4 h-4" /> Add Service
        </Button>
      </div>

      {services.length === 0 ? (
        <Card className="p-8 text-center">
          <EmptyState
            icon={<Scissors className="w-12 h-12 text-gray-400" />}
            title="No services added yet"
            description="Add at least one service with duration and price to start generating booking slots."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  addForm.reset({ name: '', duration_minutes: 30, price: 0 });
                  setIsAddOpen(true);
                }}
              >
                Add Your First Service
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 border border-gray-100 dark:border-gray-800">
          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-5 py-3">Service Name</th>
                  <th className="px-5 py-3">Duration</th>
                  <th className="px-5 py-3">Price</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {services.map((srv) => (
                  <tr key={srv.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-4 font-semibold text-gray-900 dark:text-white">
                      {srv.name}
                    </td>
                    <td className="px-5 py-4 text-gray-600 dark:text-gray-300">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        {srv.duration_minutes} mins
                      </span>
                    </td>
                    <td className="px-5 py-4 font-bold text-gray-900 dark:text-white">
                      ₹{srv.price}
                    </td>
                    <td className="px-5 py-4 text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit ${srv.name}`}
                        onClick={() => handleEditClick(srv)}
                        className="p-1.5 h-auto text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${srv.name}`}
                        onClick={() => handleDeleteClick(srv)}
                        className="p-1.5 h-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View (360px friendly) */}
          <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
            {services.map((srv) => (
              <div key={srv.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-bold text-gray-900 dark:text-white text-base">
                    {srv.name}
                  </h4>
                  <span className="font-extrabold text-base text-primary-600 dark:text-primary-400">
                    ₹{srv.price}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Duration: {srv.duration_minutes} minutes</span>
                </div>
                <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800/60">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditClick(srv)}
                    className="text-xs py-1"
                  >
                    <Edit className="w-3 h-3 mr-1" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteClick(srv)}
                    className="text-xs py-1 text-red-600 border-red-200 dark:border-red-900/60"
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Add Service Modal */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Add New Service"
        description="Provide service details, appointment duration, and price in INR."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={addMutation.isPending}
              disabled={addMutation.isPending}
              onClick={addForm.handleSubmit((data: any) => addMutation.mutate(data))}
            >
              Add Service
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={addForm.handleSubmit((data: any) => addMutation.mutate(data))}
        >
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="srv-add-name">
              Service Name *
            </label>
            <Input
              id="srv-add-name"
              placeholder="e.g. Consultation, Haircut, Checkup"
              {...addForm.register('name')}
              error={addForm.formState.errors.name?.message}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="srv-add-duration">
                Duration (minutes: 5 - 480) *
              </label>
              <Input
                id="srv-add-duration"
                type="number"
                placeholder="30"
                min={5}
                max={480}
                {...addForm.register('duration_minutes')}
                error={addForm.formState.errors.duration_minutes?.message}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="srv-add-price">
                {'Price (₹ INR, >= 0) *'}
              </label>
              <Input
                id="srv-add-price"
                type="number"
                placeholder="500"
                min={0}
                step="any"
                {...addForm.register('price')}
                error={addForm.formState.errors.price?.message}
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Edit Service Modal */}
      <Modal
        isOpen={!!editingService}
        onClose={() => setEditingService(null)}
        title="Edit Service"
        description={`Update settings for ${editingService?.name}`}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditingService(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={updateMutation.isPending}
              disabled={updateMutation.isPending}
              onClick={editForm.handleSubmit((data: any) => {
                if (editingService) {
                  updateMutation.mutate({ serviceId: editingService.id, data });
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
          onSubmit={editForm.handleSubmit((data: any) => {
            if (editingService) {
              updateMutation.mutate({ serviceId: editingService.id, data });
            }
          })}
        >
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="srv-edit-name">
              Service Name *
            </label>
            <Input
              id="srv-edit-name"
              {...editForm.register('name')}
              error={editForm.formState.errors.name?.message}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="srv-edit-duration">
                Duration (minutes: 5 - 480) *
              </label>
              <Input
                id="srv-edit-duration"
                type="number"
                min={5}
                max={480}
                {...editForm.register('duration_minutes')}
                error={editForm.formState.errors.duration_minutes?.message}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1" htmlFor="srv-edit-price">
                {'Price (₹ INR, >= 0) *'}
              </label>
              <Input
                id="srv-edit-price"
                type="number"
                min={0}
                step="any"
                {...editForm.register('price')}
                error={editForm.formState.errors.price?.message}
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* Delete Service Confirmation Modal with 409 handling */}
      <Modal
        isOpen={!!deletingService}
        onClose={() => {
          setDeletingService(null);
          setDeleteError(null);
        }}
        title="Delete Service"
        description={`Are you sure you want to delete "${deletingService?.name}"?`}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDeletingService(null);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={deleteMutation.isPending}
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deletingService) {
                  deleteMutation.mutate(deletingService.id);
                }
              }}
            >
              Confirm Delete
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Deleting this service will also automatically delete all associated free slots.
          </p>

          {deleteError && (
            <div
              data-testid="service-delete-error"
              className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Cannot Delete:</span> {deleteError}
                <p className="mt-1 text-[11px] text-red-600/80 dark:text-red-400">
                  Please cancel or complete any booked appointments for this service first before deleting it.
                </p>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
