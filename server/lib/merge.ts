export function deepMerge(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
): Record<string, unknown> {
    const result = { ...base };
    for (const key of Object.keys(override)) {
        const baseVal = base[key];
        const overrideVal = override[key];
        if (
            overrideVal !== undefined &&
            typeof baseVal === "object" &&
            !Array.isArray(baseVal) &&
            baseVal !== null &&
            typeof overrideVal === "object" &&
            !Array.isArray(overrideVal) &&
            overrideVal !== null
        ) {
            result[key] = deepMerge(
                baseVal as Record<string, unknown>,
                overrideVal as Record<string, unknown>,
            );
        } else if (overrideVal !== undefined) {
            result[key] = overrideVal;
        }
    }
    return result;
}
