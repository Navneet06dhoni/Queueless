import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Card } from '../components/ui';
import { Lock, Mail, AlertCircle } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please provide a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get('redirect') ? decodeURIComponent(searchParams.get('redirect')!) : '/';

  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null);
    try {
      await login(data);
      navigate(redirectUrl, { replace: true });
    } catch (err: any) {
      if (err.response?.status === 429) {
        setServerError('Too many login attempts. Please try again shortly.');
      } else if (err.response?.status === 403 && err.response?.data?.error?.code === 'USER_BLOCKED') {
        setServerError(err.response?.data?.error?.message || 'Your account has been suspended.');
      } else if (err.response?.data?.error?.message) {
        setServerError(err.response.data.error.message);
      } else {
        setServerError('Unable to sign in. Please check your credentials.');
      }
    }
  };

  const fillDemo = (role: 'customer' | 'owner' | 'admin') => {
    if (!import.meta.env.DEV) return;
    if (role === 'customer') {
      setValue('email', import.meta.env.VITE_DEMO_CUSTOMER_EMAIL || 'customer_1@queueless.local');
      setValue('password', import.meta.env.VITE_DEMO_CUSTOMER_PASSWORD || 'CustomerPass123!');
    } else if (role === 'owner') {
      setValue('email', import.meta.env.VITE_DEMO_OWNER_EMAIL || 'rahul@apollo.com');
      setValue('password', import.meta.env.VITE_DEMO_OWNER_PASSWORD || 'OwnerPassword123!');
    } else if (role === 'admin') {
      setValue('email', import.meta.env.VITE_DEMO_ADMIN_EMAIL || 'admin@queueless.com');
      setValue('password', import.meta.env.VITE_DEMO_ADMIN_PASSWORD || 'AdminPassword123!');
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Sign in to manage your appointments and queue status
          </p>
        </div>

        <Card className="p-6 sm:p-8">
          {serverError && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-start gap-3 text-sm text-red-600 dark:text-red-400"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Email Address"
              type="email"
              placeholder="you@example.com"
              leftIcon={<Mail className="w-4 h-4" />}
              error={errors.email?.message}
              {...register('email')}
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              leftIcon={<Lock className="w-4 h-4" />}
              error={errors.password?.message}
              {...register('password')}
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full mt-2"
              isLoading={isSubmitting}
            >
              Sign In
            </Button>
          </form>

          {/* Dev Demo Login Helper */}
          {import.meta.env.DEV && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Development Quick Fill
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fillDemo('customer')}
                  className="text-xs py-1"
                >
                  Customer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fillDemo('owner')}
                  className="text-xs py-1"
                >
                  Owner
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fillDemo('admin')}
                  className="text-xs py-1"
                >
                  Admin
                </Button>
              </div>
            </div>
          )}

          <div className="mt-6 text-center text-xs text-gray-500">
            Don't have an account?{' '}
            <Link to="/register" className="font-semibold text-primary-600 hover:text-primary-700">
              Create an account
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
};
