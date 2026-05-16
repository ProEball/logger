"use client";
import { WebhookChannelForm } from "@/features/alerts/components/configuration/WebhookChannelForm/WebhookChannelForm";
import type { WebhookChannel } from "@/features/alerts/utils/alert-schemas";
import styles from "./ChannelsEditor.module.scss";

interface ChannelsEditorProps {
    value: WebhookChannel[];
    onChange: (channels: WebhookChannel[]) => void;
}

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14"/>
        </svg>
    );
}

export function ChannelsEditor({ value, onChange }: ChannelsEditorProps) {
    const addChannel = () => onChange([...value, { type: "webhook", url: "" }]);
    const removeChannel = (i: number) => onChange(value.filter((_, idx) => idx !== i));
    const updateChannel = (i: number, channel: WebhookChannel) =>
        onChange(value.map((c, idx) => (idx === i ? channel : c)));

    return (
        <div className={styles.wrapper}>
            {value.map((channel, i) => (
                <WebhookChannelForm
                    key={i}
                    value={channel}
                    onChange={(c) => updateChannel(i, c)}
                    onRemove={() => removeChannel(i)}
                    canRemove={value.length > 1}
                />
            ))}
            <button type="button" className={styles.addBtn} onClick={addChannel}>
                <PlusIcon />Add channel
            </button>
        </div>
    );
}
