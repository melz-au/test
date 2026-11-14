import { readFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { Stream } from "../../src/contracts/generated.ts";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const cache = new Map<Stream, ValidateFunction>();

/** Compiled JSON Schema validator for a stream, generated from its ODCS contract. */
export function validatorFor(stream: Stream): ValidateFunction {
  let v = cache.get(stream);
  if (!v) {
    const schema = JSON.parse(readFileSync(`contracts/generated/jsonschema/${stream}.schema.json`, "utf8")) as object;
    v = ajv.compile(schema);
    cache.set(stream, v);
  }
  return v;
}

/** Validate an event and return readable errors (empty when valid). */
export function contractErrors(stream: Stream, event: unknown): string[] {
  const v = validatorFor(stream);
  return v(event) ? [] : (v.errors ?? []).map((e) => `${stream}${e.instancePath} ${e.message ?? ""}`);
}
