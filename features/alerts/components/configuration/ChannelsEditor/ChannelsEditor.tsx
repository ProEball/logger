"use client";
import { Button } from "@/shared/components/Button/Button";
import { WebhookChannelForm } from "@/features/alerts/components/configuration/WebhookChannelForm/WebhookChannelForm";
import { t } from "@/core/i18n/t";
import type { WebhookChannel } from "@/features/alerts/utils/alert-schemas";
import styles from "./ChannelsEditor.module.scss";

interface ChannelsEditorProps {
    value: WebhookChannel[];
    onChange: (channels: WebhookChannel[]) => void;
}

const DEFAULT_CHANNEL: WebhookChannel = { type: "webhook", url: "" };

export function ChannelsEditor({ value, onChange }: ChannelsEditorProps) {
    const addChannel = () => onChange([...value, { ...DEFAULT_CHANNEL }]);
    const removeChannel = (i: number) => onChange(value.filter((_, idx) => idx !== i));
    const updateChannel = (i: number, channel: WebhookChannel) => {
        onChange(value.map((c, idx) => (idx === i ? channel : c)));
    };

    return (
        <div className={styles.wrapper}>
            <p className={styles.label}>{t("alerts.editor.channelsTitle")}</p>
            {value.map((channel, i) => (
                <WebhookChannelForm
                    key={i}
                    value={channel}
                    index={i}
                    onChange={(c) => updateChannel(i, c)}
                    onRemove={() => removeChannel(i)}
                />
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={addChannel}>
                + {t("alerts.editor.addChannel")}
            </Button>
        </div>
    );
}
