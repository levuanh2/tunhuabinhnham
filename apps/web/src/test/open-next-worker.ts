import { vi } from "vitest";

/** Stand-in for the generated .open-next/worker.js; tests set what the Next handler returns. */
const openNext = { fetch: vi.fn<(request: Request) => Promise<Response>>() };
export default openNext;
