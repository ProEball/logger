'use client';

import {
    autoUpdate,
    flip,
    FloatingFocusManager,
    offset,
    shift,
    useClick,
    useDismiss,
    useFloating,
    useInteractions,
    useRole,
    useTransitionStyles,
    type Placement,
} from '@floating-ui/react';
import { cloneElement, useState, type ReactElement, type ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Popover.module.scss';

export interface PopoverProps {
    placement?: Placement;
    title?: ReactNode;
    footer?: ReactNode;
    width?: number | string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    trigger: ReactElement;
    children: ReactNode;
    className?: string;
}

export function Popover({
    placement = 'bottom',
    title,
    footer,
    width = 240,
    open: controlledOpen,
    onOpenChange,
    trigger,
    children,
    className,
}: PopoverProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = (value: boolean) => {
        if (!isControlled) {
            setInternalOpen(value);
        }
        onOpenChange?.(value);
    };

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement,
        whileElementsMounted: autoUpdate,
        middleware: [offset(6), flip(), shift({ padding: 8 })],
    });

    const click = useClick(context);
    const dismiss = useDismiss(context);
    const role = useRole(context);

    const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);
    const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
        duration: 150,
    });

    // floating-ui returns callback refs — destructure to avoid the react-hooks/refs
    // lint heuristic on `refs.setReference`. See Tooltip.tsx for the same note.
    const { setReference, setFloating } = refs;

    return (
        <>
            {cloneElement(
                trigger,
                getReferenceProps({
                    ref: setReference,
                    ...(trigger.props as object),
                }),
            )}
            {isMounted ? (
                <FloatingFocusManager context={context} modal={false}>
                    <div
                        ref={setFloating}
                        className={cx(styles.popover, className)}
                        style={{ ...floatingStyles, ...transitionStyles, width }}
                        {...getFloatingProps()}
                    >
                        {title !== undefined ? (
                            <header className={styles.header}>
                                <div className={styles.title}>{title}</div>
                            </header>
                        ) : null}
                        <div className={styles.body}>{children}</div>
                        {footer !== undefined ? (
                            <footer className={styles.footer}>{footer}</footer>
                        ) : null}
                    </div>
                </FloatingFocusManager>
            ) : null}
        </>
    );
}
