import type { HeyAgentApi } from "../../shared/contracts";

declare global {
  interface Window {
    heyAgent: HeyAgentApi;
  }
}

export {};
