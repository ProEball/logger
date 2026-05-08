export function slugify(input: string): string {
    return input
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        || "project";
}

export function slugifyWithSuffix(input: string, attempt: number): string {
    const base = slugify(input);
    if (attempt === 0) return base;
    const suffix = `-${attempt + 1}`;
    return base.slice(0, 60 - suffix.length) + suffix;
}
