import type { Env as TwinEnv } from "../../src/env.ts";

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging
    interface Env extends TwinEnv {}
    interface GlobalProps {
      mainModule: typeof import("../../src/index.ts");
    }
  }
}
