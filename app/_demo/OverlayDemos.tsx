'use client';

import { useState } from 'react';
import {
    Button,
    Modal,
    Popover,
    Tooltip,
    useToast,
} from '@/shared/components';

export function OverlayDemos() {
    const [modalOpen, setModalOpen] = useState(false);
    const toast = useToast();

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
                Open modal
            </Button>

            <Tooltip content="Copies API key to clipboard">
                <Button variant="secondary">Copy key</Button>
            </Tooltip>

            <Popover
                title="Delete project"
                footer={
                    <>
                        <Button variant="ghost" size="sm">Cancel</Button>
                        <Button variant="danger" size="sm">Delete project</Button>
                    </>
                }
                trigger={<Button variant="secondary">Confirm popover</Button>}
            >
                This will permanently delete <strong>api-gateway</strong> and all its events.
                This cannot be undone.
            </Popover>

            <Button
                variant="secondary"
                onClick={() => toast.push({
                    title: 'Alert rule created',
                    body: 'Fires when error count >= 10 in 5 min.',
                    variant: 'success',
                })}
            >
                Toast: success
            </Button>
            <Button
                variant="secondary"
                onClick={() => toast.push({
                    title: 'Failed to save alert rule',
                    body: 'Server returned 422. Check the condition threshold.',
                    variant: 'danger',
                })}
            >
                Toast: danger
            </Button>
            <Button
                variant="secondary"
                onClick={() => toast.push({
                    title: 'Webhook delivery delayed',
                    body: 'Retrying every 30 seconds.',
                    variant: 'warning',
                })}
            >
                Toast: warning
            </Button>

            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title="Delete project"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="danger" onClick={() => setModalOpen(false)}>
                            Delete project
                        </Button>
                    </>
                }
            >
                This will permanently delete <strong>api-gateway</strong> and all its events.
                This cannot be undone.
            </Modal>
        </div>
    );
}
