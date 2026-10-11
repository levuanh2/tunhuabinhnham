import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Use the adapter's in-memory/dummy incremental cache by default. This keeps
// deployment free of an implicit R2 dependency; add R2 only after the resource
// and cache invalidation behavior are explicitly approved and tested.
export default defineCloudflareConfig();
