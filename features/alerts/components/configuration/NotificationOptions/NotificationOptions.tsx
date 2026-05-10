"use client";
import { Checkbox } from "@/shared/components/Checkbox/Checkbox";
import { t } from "@/core/i18n/t";

interface NotificationOptionsProps {
    notifyOnResolve: boolean;
    onChange: (value: boolean) => void;
}

export function NotificationOptions({ notifyOnResolve, onChange }: NotificationOptionsProps) {
    return (
        <Checkbox
            label={t("alerts.editor.notifyOnResolve")}
            checked={notifyOnResolve}
            onChange={(e) => onChange(e.target.checked)}
        />
    );
}
