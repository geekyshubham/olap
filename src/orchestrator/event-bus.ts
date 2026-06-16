import type { OlapOrchestratorEvent } from "../domain/events.js";

type Handler = (event: OlapOrchestratorEvent) => void;

export class EventBus {
  private handlers = new Set<Handler>();

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: OlapOrchestratorEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // subscriber errors must not break orchestrator
      }
    }
  }
}