import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-950 text-center">
          <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-3xl p-8 border border-gray-100 dark:border-gray-800 shadow-soft-lg">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 mx-auto flex items-center justify-center mb-5">
              <AlertOctagon className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              An unexpected error occurred
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              The application encountered a runtime error. You can try refreshing the page or returning home.
            </p>
            <div className="flex justify-center gap-3">
              <Button
                variant="primary"
                onClick={() => window.location.reload()}
                leftIcon={<RefreshCw className="w-4 h-4" />}
              >
                Reload Page
              </Button>
              <Button
                variant="outline"
                onClick={() => (window.location.href = '/')}
              >
                Go Home
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
