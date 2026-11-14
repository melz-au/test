import type { ScenarioLogEvent, Stream, StreamEvents } from "../contracts/generated.ts";
import type { FeedContext } from "../feeds/envelope.ts";
import type { Asset } from "../model/assets.ts";
import type { PhysicsState } from "../model/physics.ts";
import type { SiteSpec } from "../model/sites.ts";

export const SCENARIO_NAMES = ["rogue_setpoint", "rogue_device", "unauthorised_logic_change"] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];
export const isScenarioName = (s: string): s is ScenarioName => (SCENARIO_NAMES as readonly string[]).includes(s);

/** A scheduled or running scenario. Stored in the site state so it survives eviction. */
export interface ScenarioInstance {
  /** Hidden ground-truth identifier, written only to scenario_log. */
  id: string;
  name: ScenarioName;
  startMs: number;
  /** "random" when injected by the low-rate scheduler, otherwise "api". */
  origin: "api" | "random";
  done: boolean;
  /** Scenario-specific progress (JSON-serialisable). */
  data: Record<string, unknown>;
}

export interface ScenarioContext {
  feed: FeedContext;
  site: SiteSpec;
  seed: string;
  assets: Asset[];
  physics: PhysicsState | null;
  emit<S extends Exclude<Stream, "scenario_log">>(stream: S, event: StreamEvents[S]): StreamEvents[S];
  /** Record a ground-truth step in scenario_log. */
  logStep(
    inst: ScenarioInstance,
    tsMs: number,
    step: number,
    stepName: string,
    technique: string | null,
    expectedRuleIds: string[],
    evidence: { event_id: string }[],
    description: string,
  ): ScenarioLogEvent;
  /** Raise a compliance signal at head office (degrades a control for 7 days). */
  signal(controlId: string, tsMs: number): void;
}

export interface ScenarioDriver {
  name: ScenarioName;
  /** Default start time for an on-demand trigger, given the current simulated time. */
  defaultStart(nowMs: number): number;
  /** Total duration, used to decide when an instance is finished. */
  durationMinutes: number;
  /** Whether the scenario can run at this site. */
  supports(site: SiteSpec): boolean;
  /** Emit this minute's events and apply state effects. Return true when finished. */
  onMinute(ctx: ScenarioContext, inst: ScenarioInstance, minuteMs: number): boolean;
}
