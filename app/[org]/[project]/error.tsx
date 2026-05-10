'use client';

import { GlobalErrorPage } from '@/shared/components/ErrorBoundary/GlobalErrorPage';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return <GlobalErrorPage error={error} reset={reset} />;
}
