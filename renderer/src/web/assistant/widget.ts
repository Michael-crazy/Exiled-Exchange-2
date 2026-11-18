import type { Widget } from "../overlay/widgets.js";

export interface AssistantEvalWidget extends Widget {
  hotkey: string | null;
}
