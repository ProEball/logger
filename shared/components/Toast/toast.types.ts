import type { ReactNode } from 'react';

export type ToastVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
    title?: ReactNode;
    body?: ReactNode;
    variant?: ToastVariant;
    duration?: number;
}

export interface ToastItem extends Required<Pick<ToastOptions, 'variant'>> {
    id: string;
    title?: ReactNode;
    body?: ReactNode;
    duration: number;
}

export interface ToastApi {
    push: (options: ToastOptions) => string;
    dismiss: (id: string) => void;
    clear: () => void;
}
