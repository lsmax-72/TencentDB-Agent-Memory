import { ZodError } from "zod";
import { EVOLUTION_ACTIONS, EvolutionService } from "../evolution/control/service.js";
import { EvolutionError } from "../evolution/control/types.js";
import { errorEnvelope, successEnvelope } from "./v2-router.js";
import type { ApiResponseEnvelope, V2AuthContext } from "./v2-schemas.js";

export function makeEvolutionRouteTable(resolve: (instanceId: string) => Promise<EvolutionService>, userKey: string) {
  return Object.fromEntries(EVOLUTION_ACTIONS.map(action => [`/v3/evolution/${action}`, async (body: unknown, auth: V2AuthContext, requestId: string): Promise<ApiResponseEnvelope> => {
    if (!userKey) return errorEnvelope(401, "USER_KEY_REQUIRED", requestId);
    try { return successEnvelope(await (await resolve(auth.serviceId)).invoke(action, body, userKey), requestId); }
    catch (error) {
      if (error instanceof EvolutionError) return errorEnvelope(error.code, error.message, requestId);
      if (error instanceof ZodError) return errorEnvelope(400, "INVALID_EVOLUTION_REQUEST", requestId);
      // Do not echo storage paths, credentials or source bodies in errors.
      return errorEnvelope(500, "EVOLUTION_INTERNAL_ERROR", requestId);
    }
  }]));
}
