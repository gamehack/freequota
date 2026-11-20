import { defineConfig } from "cf/config";
import * as entrypoint from "./src/worker/index.ts" with { type: "cf-worker" };

export default defineConfig({
  accountId: "ceb5fb8c6f427ea71ca6d4bce7c278f1",
  worker: {
    name: "freequota",
    compatibilityDate: "2026-11-20",
    workersDev: false,
    previewUrls: false,
    entrypoint,
    assets: {
      runWorkerFirst: ["/api/*"],
      notFoundHandling: "single-page-application",
    },
  },
});
