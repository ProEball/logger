import type { PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { db } from "@/core/db/client";
import { alertNotifications, alertRules, organizations, projects } from "@/core/db/schema";
import { buildPayload } from "@/features/alerts/utils/build-payload";
import { deliver } from "@/features/alerts/services/alert-dispatcher.service";

export const ALERT_DELIVERY_JOB = "alert-delivery";

type DeliveryJobData = {
    notificationId: string;
    ruleId: string;
    channelUrl: string;
    channelHeaders: Array<{ key: string; value: string }>;
};

async function processDelivery(data: DeliveryJobData): Promise<void> {
    const { notificationId, channelUrl, channelHeaders } = data;

    const [row] = await db
        .select({
            notification: alertNotifications,
            rule: alertRules,
            projectSlug: projects.slug,
            orgSlug: organizations.slug,
        })
        .from(alertNotifications)
        .innerJoin(alertRules, eq(alertRules.id, alertNotifications.alertRuleId))
        .innerJoin(projects, eq(projects.id, alertRules.projectId))
        .innerJoin(organizations, eq(organizations.id, projects.organizationId))
        .where(eq(alertNotifications.id, notificationId))
        .limit(1);

    if (!row) {
        console.warn(`[alert-delivery] notification ${notificationId} not found — skipping`);
        return;
    }

    const { notification, rule, projectSlug, orgSlug } = row;
    const previousState = notification.state === "firing" ? "ok" : "firing";

    const payload = await buildPayload(
        rule,
        notification.state,
        previousState,
        notification.triggeredAt,
        orgSlug,
        projectSlug,
    );

    await deliver(notificationId, channelUrl, payload as Record<string, unknown>, channelHeaders);
}

export async function registerAlertDeliveryJob(boss: PgBoss): Promise<void> {
    await boss.work<DeliveryJobData>(ALERT_DELIVERY_JOB, async (jobs) => {
        await Promise.all(
            jobs.map((job) =>
                processDelivery(job.data).catch((err) => {
                    console.error(`[alert-delivery] job ${job.id} failed:`, err);
                    throw err; // re-throw so pg-boss marks job as failed and retries
                }),
            ),
        );
    });
}
