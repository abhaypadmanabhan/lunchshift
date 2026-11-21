// Client-safe memory status strings, shared by the Cognee adapter (server) and the labels in the app.

/** Recall error prefix while a family's first Cognee graph is still being built (cognify takes about 30 s). */
export const COGNEE_BUILDING = "cognee is still building this family's memory";
export const isMemoryBuilding = (error: string | null | undefined) => Boolean(error?.startsWith(COGNEE_BUILDING));
