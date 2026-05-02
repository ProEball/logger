import { dictionary } from "@/core/i18n/dictionary";

type NestedKeys<T, Prefix extends string = ""> = {
    [K in keyof T]: T[K] extends Record<string, unknown>
        ? NestedKeys<T[K], `${Prefix}${Prefix extends "" ? "" : "."}${K & string}`>
        : `${Prefix}${Prefix extends "" ? "" : "."}${K & string}`;
}[keyof T];

export type TranslationKey = NestedKeys<typeof dictionary>;

export function t(key: TranslationKey): string {
    const parts = key.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = dictionary;

    for (const part of parts) {
        if (node == null || typeof node !== "object") {
            return key;
        }
        node = node[part];
    }

    if (typeof node === "string") {
        return node;
    }

    return key;
}
