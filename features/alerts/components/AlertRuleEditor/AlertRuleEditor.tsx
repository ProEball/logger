"use client";
import { useReducer, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/shared/components/Toast/ToastProvider";
import { FilterBuilder } from "@/features/alerts/components/configuration/FilterBuilder/FilterBuilder";
import { ConditionEditor } from "@/features/alerts/components/configuration/ConditionEditor/ConditionEditor";
import { ChannelsEditor } from "@/features/alerts/components/configuration/ChannelsEditor/ChannelsEditor";
import { NotificationOptions } from "@/features/alerts/components/configuration/NotificationOptions/NotificationOptions";
import { SaveBar } from "@/features/alerts/components/configuration/SaveBar/SaveBar";
import { AlertRuleEditorTabs } from "@/features/alerts/components/AlertRuleEditorTabs/AlertRuleEditorTabs";
import { AlertHistoryTable } from "@/features/alerts/components/history/AlertHistoryTable/AlertHistoryTable";
import { createAlertRuleAction } from "@/features/alerts/actions/create-alert-rule.action";
import { updateAlertRuleAction } from "@/features/alerts/actions/update-alert-rule.action";
import { t } from "@/core/i18n/t";
import type { AlertRule, AlertNotification } from "@/core/db/schema";
import type { AlertCondition, WebhookChannel } from "@/features/alerts/utils/alert-schemas";
import type { EventFilters } from "@/shared/utils/event-filters.schema";
import styles from "./AlertRuleEditor.module.scss";

const DEFAULT_FILTER: EventFilters = { range: { type: "preset", value: "1h" } };
const DEFAULT_CONDITION: AlertCondition = { type: "threshold", count: 10, windowMinutes: 5 };
const DEFAULT_CHANNEL: WebhookChannel = { type: "webhook", url: "" };

type FormState = {
    name: string;
    description: string;
    filter: EventFilters;
    condition: AlertCondition;
    channels: WebhookChannel[];
    notifyOnResolve: boolean;
    tab: "configuration" | "history";
};

type Action =
    | { type: "setName"; value: string }
    | { type: "setDescription"; value: string }
    | { type: "setFilter"; value: EventFilters }
    | { type: "setCondition"; value: AlertCondition }
    | { type: "setChannels"; value: WebhookChannel[] }
    | { type: "setNotifyOnResolve"; value: boolean }
    | { type: "setTab"; value: "configuration" | "history" };

function reducer(state: FormState, action: Action): FormState {
    switch (action.type) {
        case "setName": return { ...state, name: action.value };
        case "setDescription": return { ...state, description: action.value };
        case "setFilter": return { ...state, filter: action.value };
        case "setCondition": return { ...state, condition: action.value };
        case "setChannels": return { ...state, channels: action.value };
        case "setNotifyOnResolve": return { ...state, notifyOnResolve: action.value };
        case "setTab": return { ...state, tab: action.value };
    }
}

interface AlertRuleEditorProps {
    rule?: AlertRule;
    notifications?: AlertNotification[];
    notificationsTotal?: number;
    orgSlug: string;
    projectSlug: string;
}

export function AlertRuleEditor({
    rule,
    notifications = [],
    notificationsTotal = 0,
    orgSlug,
    projectSlug,
}: AlertRuleEditorProps) {
    const router = useRouter();
    const toast = useToast();
    const [isPending, startTransition] = useTransition();
    const isEdit = !!rule;

    const [state, dispatch] = useReducer(reducer, {
        name: rule?.name ?? "",
        description: rule?.description ?? "",
        filter: (rule?.filter as EventFilters) ?? DEFAULT_FILTER,
        condition: (rule?.condition as AlertCondition) ?? DEFAULT_CONDITION,
        channels: (rule?.channels as WebhookChannel[]) ?? [{ ...DEFAULT_CHANNEL }],
        notifyOnResolve: rule?.notifyOnResolve ?? true,
        tab: "configuration",
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        startTransition(async () => {
            const input = {
                name: state.name,
                description: state.description || undefined,
                filter: state.filter,
                condition: state.condition,
                channels: state.channels,
                notifyOnResolve: state.notifyOnResolve,
            };

            let result;
            if (isEdit && rule) {
                result = await updateAlertRuleAction(orgSlug, projectSlug, { id: rule.id, ...input });
            } else {
                result = await createAlertRuleAction(orgSlug, projectSlug, input);
            }

            if ("error" in result) {
                toast.push({ variant: 'danger', title: 'Failed to save', body: result.error });
                return;
            }

            router.push(`/${orgSlug}/${projectSlug}/alerts`);
        });
    };

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <h1 className={styles.title}>
                    {isEdit ? t("alerts.editor.editTitle") : t("alerts.editor.newTitle")}
                </h1>
                {isEdit && (
                    <AlertRuleEditorTabs
                        activeTab={state.tab}
                        onChange={(tab) => dispatch({ type: "setTab", value: tab })}
                    />
                )}
            </div>

            {state.tab === "history" ? (
                <AlertHistoryTable
                    notifications={notifications}
                    total={notificationsTotal}
                />
            ) : (
                <form className={styles.form} onSubmit={handleSubmit}>
                    <section className={styles.section}>
                        <div className={styles.field}>
                            <label className={styles.fieldLabel}>
                                {t("alerts.editor.nameLabel")}
                            </label>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder={t("alerts.editor.namePlaceholder")}
                                value={state.name}
                                onChange={(e) => dispatch({ type: "setName", value: e.target.value })}
                                required
                            />
                        </div>

                        <div className={styles.field}>
                            <label className={styles.fieldLabel}>
                                {t("alerts.editor.descriptionLabel")}
                            </label>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder={t("alerts.editor.descriptionPlaceholder")}
                                value={state.description}
                                onChange={(e) => dispatch({ type: "setDescription", value: e.target.value })}
                            />
                        </div>
                    </section>

                    <section className={styles.section}>
                        <FilterBuilder
                            value={state.filter}
                            onChange={(filter) => dispatch({ type: "setFilter", value: filter })}
                        />
                    </section>

                    <section className={styles.section}>
                        <ConditionEditor
                            value={state.condition}
                            onChange={(condition) => dispatch({ type: "setCondition", value: condition })}
                        />
                    </section>

                    <section className={styles.section}>
                        <ChannelsEditor
                            value={state.channels}
                            onChange={(channels) => dispatch({ type: "setChannels", value: channels })}
                        />
                    </section>

                    <section className={styles.section}>
                        <NotificationOptions
                            notifyOnResolve={state.notifyOnResolve}
                            onChange={(v) => dispatch({ type: "setNotifyOnResolve", value: v })}
                        />
                    </section>

                    <SaveBar
                        orgSlug={orgSlug}
                        projectSlug={projectSlug}
                        isPending={isPending}
                        isEdit={isEdit}
                    />
                </form>
            )}
        </div>
    );
}
