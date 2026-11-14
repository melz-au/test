import { rogueDevice } from "./rogue-device.ts";
import { rogueSetpoint } from "./rogue-setpoint.ts";
import type { ScenarioDriver, ScenarioName } from "./types.ts";
import { unauthorisedLogicChange } from "./unauthorised-logic-change.ts";

export const DRIVERS: Record<ScenarioName, ScenarioDriver> = {
  rogue_setpoint: rogueSetpoint,
  rogue_device: rogueDevice,
  unauthorised_logic_change: unauthorisedLogicChange,
};
