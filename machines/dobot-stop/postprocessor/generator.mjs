import { translateDobot } from "../../reference-dobot-mg400-struderbot/postprocessor/generator.mjs";

export function translate(args) {
  return translateDobot(args, true);
}
