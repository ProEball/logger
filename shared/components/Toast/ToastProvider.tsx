'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { ToastApi, ToastItem, ToastOptions } from './toast.types';
import { ToastList } from './parts/ToastList';

// React-blessed "are we in the client render?" pattern. Server snapshot returns
// false, client snapshot returns true → portal is skipped during SSR and the
// initial hydration pass, then activates one render later. Avoids the
// useEffect+setState pattern (which trips react-hooks/set-state-in-effect in
// React 19) and avoids the document-existence check (which would mismatch).
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function useIsClient(): boolean {
    return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

const DEFAULT_DURATION = 5000;

const ToastContext = createContext<ToastApi | null>(null);

type Action =
    | { type: 'push'; toast: ToastItem }
    | { type: 'dismiss'; id: string }
    | { type: 'clear' };

function reducer(state: ToastItem[], action: Action): ToastItem[] {
    switch (action.type) {
        case 'push':
            return [...state, action.toast];
        case 'dismiss':
            return state.filter((t) => t.id !== action.id);
        case 'clear':
            return [];
        default:
            return state;
    }
}

let counter = 0;
const generateId = (): string => {
    counter += 1;
    return `toast-${Date.now()}-${counter}`;
};

export interface ToastProviderProps {
    children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
    const [toasts, dispatch] = useReducer(reducer, []);
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const isClient = useIsClient();

    const dismiss = useCallback((id: string) => {
        const timer = timersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
        dispatch({ type: 'dismiss', id });
    }, []);

    const push = useCallback(
        (options: ToastOptions): string => {
            const toast: ToastItem = {
                id: generateId(),
                title: options.title,
                body: options.body,
                variant: options.variant ?? 'default',
                duration: options.duration ?? DEFAULT_DURATION,
            };
            dispatch({ type: 'push', toast });
            if (toast.duration > 0) {
                const timer = setTimeout(() => dismiss(toast.id), toast.duration);
                timersRef.current.set(toast.id, timer);
            }
            return toast.id;
        },
        [dismiss],
    );

    const clear = useCallback(() => {
        timersRef.current.forEach((timer) => clearTimeout(timer));
        timersRef.current.clear();
        dispatch({ type: 'clear' });
    }, []);

    useEffect(() => {
        const timers = timersRef.current;
        return () => {
            timers.forEach((timer) => clearTimeout(timer));
            timers.clear();
        };
    }, []);

    const api = useMemo<ToastApi>(() => ({ push, dismiss, clear }), [push, dismiss, clear]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            {isClient
                ? createPortal(
                      <ToastList toasts={toasts} onDismiss={dismiss} />,
                      document.body,
                  )
                : null}
        </ToastContext.Provider>
    );
}

export function useToast(): ToastApi {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return ctx;
}
