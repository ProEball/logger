'use client';

import {
    arrow,
    autoUpdate,
    flip,
    FloatingArrow,
    offset,
    shift,
    useDismiss,
    useFloating,
    useFocus,
    useHover,
    useInteractions,
    useRole,
    useTransitionStyles,
    type Placement,
} from '@floating-ui/react';
import { cloneElement, useRef, useState, type ReactElement, type ReactNode } from 'react';
import styles from './Tooltip.module.scss';

export interface TooltipProps {
    content: ReactNode;
    placement?: Placement;
    delay?: number;
    children: ReactElement;
}

const ARROW_HEIGHT = 5;

export function Tooltip({
    content,
    placement = 'top',
    delay = 200,
    children,
}: TooltipProps) {
    const [open, setOpen] = useState(false);
    const arrowRef = useRef<SVGSVGElement>(null);

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement,
        whileElementsMounted: autoUpdate,
        middleware: [
            offset(ARROW_HEIGHT + 2),
            flip(),
            shift({ padding: 8 }),
            // floating-ui canonical pattern: passes the ref object so its middleware
            // can read it inside positioning effects, NOT during render.
            // eslint-disable-next-line react-hooks/refs
            arrow({ element: arrowRef }),
        ],
    });

    const hover = useHover(context, { delay: { open: delay, close: 0 }, move: false });
    const focus = useFocus(context);
    const dismiss = useDismiss(context);
    const role = useRole(context, { role: 'tooltip' });

    const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
    const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
        duration: 100,
    });

    // floating-ui returns callback refs (functions), not React refs — destructure to
    // avoid the react-hooks/refs lint heuristic which trips on `refs.setReference`.
    const { setReference, setFloating } = refs;

    return (
        <>
            {cloneElement(
                children,
                getReferenceProps({
                    ref: setReference,
                    ...(children.props as object),
                }),
            )}
            {isMounted ? (
                <div
                    ref={setFloating}
                    className={styles.tooltip}
                    style={{ ...floatingStyles, ...transitionStyles }}
                    {...getFloatingProps()}
                >
                    {content}
                    <FloatingArrow
                        ref={arrowRef}
                        context={context}
                        className={styles.arrow}
                        height={ARROW_HEIGHT}
                        width={10}
                    />
                </div>
            ) : null}
        </>
    );
}
