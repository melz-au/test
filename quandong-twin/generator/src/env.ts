import type { ConfigVars } from "./config.ts";
import type { SiteTwin } from "./site.ts";

export interface Env extends ConfigVars {
  SITE_TWIN: DurableObjectNamespace<SiteTwin>;
  /** Workspace URL, e.g. https://dbc-xxxxxxxx-xxxx.cloud.databricks.com. Secret. */
  DATABRICKS_HOST?: string;
  /** Databricks personal access token. Secret. */
  DATABRICKS_TOKEN?: string;
  /** Shared secret for the scenario API (X-Scenario-Key header). Secret. */
  SCENARIO_API_KEY?: string;
  /** "true" enables the local debug endpoints (only ever set in .dev.vars). */
  LOCAL_MODE?: string;
}
