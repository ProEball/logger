"use client";
import { useReducer, useTransition } from "react";
import Link from "next/link";
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
import { testAlertRuleAction } from "@/features/alerts/actions/test-alert-rule.action";
import { t } from "@/core/i18n/t";
import type { AlertRule, AlertNotification } from "@/core/db/schema";
import type { AlertCondition, WebhookChannel } from "@/features/alerts/utils/alert-schemas";
import type { EventFilters } from "@/shared/utils/event-filters.schema";
import styles from "./AlertRuleEditor.module.scss";

const DEFAULT_FILTER: EventFilters = { range: { type: "preset", value: "1h" } };
const DEFAULT_CONDITION: AlertCondition = { type: "threshold", count: 10, windowMinutes: 5 };

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
        case "setName":            return { ...state, name: action.value };
        case "setDescription":     return { ...state, description: action.value };
        case "setFilter":          return { ...state, filter: action.value };
        case "setCondition":       return { ...state, condition: action.value };
        case "setChannels":        return { ...state, channels: action.value };
        case "setNotifyOnResolve": return { ...state, notifyOnResolve: action.value };
        case "setTab":             return { ...state, tab: action.value };
    }
}

function ChevronLeftIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="m15 18-6-6 6-6"/>
        </svg>
    );
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
    const alertsHref = `/${orgSlug}/${projectSlug}/alerts`;

    const [state, dispatch] = useReducer(reducer, {
        name: rule?.name ?? "",
        description: rule?.description ?? "",
        filter: (rule?.filter as EventFilters) ?? DEFAULT_FILTER,
        condition: (rule?.condition as AlertCondition) ?? DEFAULT_CONDITION,
        channels: (rule?.channels as WebhookChannel[]) ?? [{ type: "webhook", url: "" }],
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

            const result = isEdit && rule
                ? await updateAlertRuleAction(orgSlug, projectSlug, { id: rule.id, ...input })
                : await createAlertRuleAction(orgSlug, projectSlug, input);

            if ("error" in result) {
                toast.push({ variant: "danger", title: "Failed to save", body: result.error });
                return;
            }
            router.push(alertsHref);
        });
    };

    const handleTestFire = isEdit && rule ? () => {
        startTransition(async () => {
            const result = await testAlertRuleAction(orgSlug, projectSlug, rule.id);
            if ("ok" in result) {
                toast.push({ variant: "success", title: "Test sent", body: `HTTP ${result.httpStatus}` });
            } else {
                toast.push({ variant: "danger", title: "Test failed", body: result.error });
            }
        });
    } : undefined;

    const showConfig = !isEdit || state.tab === "configuration";

    return (
        <div className={styles.page}>
            <div className={styles.formWrap}>
                <div className={styles.formHead}>
                    <Link href={alertsHref} className={styles.backLink}>
                        <ChevronLeftIcon />Alerts
                    </Link>
                    <h1 className={styles.title}>
                        {isEdit ? rule.name : t("alerts.editor.newTitle")}
                    </h1>
                    {isEdit && (
                        <AlertRuleEditorTabs
                            activeTab={state.tab}
                            onChange={(tab) => dispatch({ type: "setTab", value: tab })}
                        />
                    )}
                </div>

                {showConfig ? (
                    <form onSubmit={handleSubmit} style={{ display: "contents" }}>
                        <div className={styles.formBody}>
                            {/* Section 1 — Basic */}
                            <div className={styles.section}>
                                <div className={styles.secLabel}>Rule</div>
                                <div className={styles.stack}>
                                    <div>
                                        <label className={styles.fieldLabel}>{t("alerts.editor.nameLabel")}</label>
                                        <input
                                            type="text"
                                            className={styles.input}
                                            placeholder={t("alerts.editor.namePlaceholder")}
                                            value={state.name}
                                            onChange={(e) => dispatch({ type: "setName", value: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className={styles.fieldLabel}>{t("alerts.editor.descriptionLabel")}</label>
                                        <input
                                            type="text"
                                            className={styles.input}
                                            placeholder={t("alerts.editor.descriptionPlaceholder")}
                                            value={state.description}
                                            onChange={(e) => dispatch({ type: "setDescription", value: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Section 2 — Condition */}
                            <div className={styles.section}>
                                <div className={styles.secLabel}>Condition</div>
                                <ConditionEditor
                                    value={state.condition}
                                    onChange={(condition) => dispatch({ type: "setCondition", value: condition })}
                                />
                                <FilterBuilder
                                    value={state.filter}
                                    onChange={(filter) => dispatch({ type: "setFilter", value: filter })}
                                />
                            </div>

                            {/* Section 3 — Channels */}
                            <div className={styles.section}>
                                <div className={styles.secLabel}>Channels</div>
                                <ChannelsEditor
                                    value={state.channels}
                                    onChange={(channels) => dispatch({ type: "setChannels", value: channels })}
                                />
                            </div>

                            {/* Section 4 — Options */}
                            <div className={styles.section}>
                                <div className={styles.secLabel}>Options</div>
                                <NotificationOptions
                                    notifyOnResolve={state.notifyOnResolve}
                                    onChange={(v) => dispatch({ type: "setNotifyOnResolve", value: v })}
                                />
                            </div>
                        </div>

                        <SaveBar
                            orgSlug={orgSlug}
                            projectSlug={projectSlug}
                            isPending={isPending}
                            isEdit={isEdit}
                            onTestFire={handleTestFire}
                        />
                    </form>
                ) : (
                    <div className={styles.historyWrap}>
                        <AlertHistoryTable
                            notifications={notifications}
                            total={notificationsTotal}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
