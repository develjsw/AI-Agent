import { pino } from "pino";
import { loadConfig } from "./config.js";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: loadConfig().LOG_LEVEL,
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss.l" },
    },
  }),
});

export function child(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
