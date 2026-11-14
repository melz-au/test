import type { ScenarioDriver, ScenarioName } from "./types.ts";

// Scenario drivers are added in phase (c).
export const DRIVERS = {} as Record<ScenarioName, ScenarioDriver>;
