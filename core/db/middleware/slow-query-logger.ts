import { logger } from "@/core/logger";
import type postgres from "postgres";

const SLOW_THRESHOLD_MS = 500;

type PgSql = ReturnType<typeof postgres>;

// Proxies the postgres.js tagged-template call to measure wall-clock time.
// Only the apply trap is set — all property accesses (begin, end, options, …)
// fall through to the original client unchanged.
export function wrapWithSlowQueryLogger(client: PgSql): PgSql {
    return new Proxy(client, {
        apply(_target: PgSql, thisArg: unknown, args: unknown[]) {
            const start = performance.now();
            const result = Reflect.apply(
                client as unknown as (...a: unknown[]) => unknown,
                thisArg,
                args,
            ) as PromiseLike<unknown>;

            const [strings, ...values] = args as [TemplateStringsArray, ...unknown[]];

            void Promise.resolve(result).then(() => {
                const duration_ms = Math.round(performance.now() - start);
                if (duration_ms >= SLOW_THRESHOLD_MS) {
                    logger.warn(
                        {
                            sql: Array.from(strings).join("?").trim().replace(/\s+/g, " "),
                            duration_ms,
                            params_count: values.length,
                        },
                        "slow query",
                    );
                }
            });

            return result;
        },
    } as unknown as ProxyHandler<PgSql>);
}
