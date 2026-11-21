import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Card } from '../components/ui';
import { Lock, Mail, User as UserIcon, AlertCircle, Briefcase, UserCheck } from 'lucide-react';

const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters long')
    .max(100, 'Name must not exceed 100 characters'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(passwordRegex, 'Password must contain at least one letter and one number'),
  role: z.enum(['customer', 'owner']),
});

export type RegisterFormData = z.infer<typeof registerSchema>;

export const RegisterPage: React.FC = () => {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  React.useEffect(() => {
    document.title = 'Sign Up | QueueLess';
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      role: 'customer',
    },
  });

  const selectedRole = watch('role');
  const watchedPassword = watch('password') || '';

  // Password strength calculation
  const passwordStrength = useMemo(() => {
    let score = 0;
    if (watchedPassword.length >= 8) score++;
    if (/[A-Z]/.test(watchedPassword)) score++;
    if (/\d/.test(watchedPassword)) score++;
    if (/[^A-Za-z0-9]/.test(watchedPassword)) score++;
    return score;
  }, [watchedPassword]);

  const strengthLabels = ['Too Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const strengthColors = [
    'bg-gray-200 dark:bg-gray-700',
    'bg-red-500',
    'bg-amber-500',
    'bg-primary-500',
    'bg-emerald-500',
  ];

  const onSubmit = async (data: RegisterFormData) => {
    setServerError(null);
    try {
      await registerUser(data);
      navigate('/', { replace: true });
    } catch (err: any) {
      if (err.response?.status === 429) {
        setServerError('Too many registration attempts. Please try again shortly.');
      } else if (err.response?.status === 409) {
        setServerError('An account with this email address already exists.');
      } else if (err.response?.data?.error?.message) {
        setServerError(err.response.data.error.message);
      } else {
        setServerError('Unable to complete registration. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
            Create an account
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Join QueueLess to book appointments and track live queues
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
            {/* Role Selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-2">
                I want to join as:
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setValue('role', 'customer')}
                  className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                    selectedRole === 'customer'
                      ? 'border-primary-600 bg-primary-50/60 dark:bg-primary-950/40 text-primary-900 dark:text-primary-100 ring-2 ring-primary-500'
                      : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <UserCheck className={`w-5 h-5 mt-0.5 shrink-0 ${selectedRole === 'customer' ? 'text-primary-600' : 'text-gray-400'}`} />
                  <div>
                    <p className="font-semibold text-xs sm:text-sm">Customer</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Book & queue</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setValue('role', 'owner')}
                  className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                    selectedRole === 'owner'
                      ? 'border-primary-600 bg-primary-50/60 dark:bg-primary-950/40 text-primary-900 dark:text-primary-100 ring-2 ring-primary-500'
                      : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <Briefcase className={`w-5 h-5 mt-0.5 shrink-0 ${selectedRole === 'owner' ? 'text-primary-600' : 'text-gray-400'}`} />
                  <div>
                    <p className="font-semibold text-xs sm:text-sm">Business Owner</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Manage queue</p>
                  </div>
                </button>
              </div>
              {errors.role && (
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                  {errors.role.message}
                </p>
              )}
            </div>

            <Input
              label="Full Name"
              type="text"
              placeholder="Aarav Patel"
              leftIcon={<UserIcon className="w-4 h-4" />}
              error={errors.name?.message}
              {...register('name')}
            />

            <Input
              label="Email Address"
              type="email"
              placeholder="aarav@example.com"
              leftIcon={<Mail className="w-4 h-4" />}
              error={errors.email?.message}
              {...register('email')}
            />

            <div>
              <Input
                label="Password"
                type="password"
                placeholder="At least 8 chars with letter & number"
                leftIcon={<Lock className="w-4 h-4" />}
                error={errors.password?.message}
                {...register('password')}
              />

              {/* Password strength indicator */}
              {watchedPassword.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-500">Password strength:</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {strengthLabels[passwordStrength]}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex gap-1">
                    {[1, 2, 3, 4].map((step) => (
                      <div
                        key={step}
                        className={`h-full flex-1 rounded-full transition-all ${
                          passwordStrength >= step
                            ? strengthColors[passwordStrength]
                            : 'bg-gray-200 dark:bg-gray-800'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400">
                    Must be at least 8 characters and include both letters and numbers.
                  </p>
                </div>
              )}
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full mt-4"
              isLoading={isSubmitting}
            >
              Create Account
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-primary-600 hover:text-primary-700">
              Sign in
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
};
