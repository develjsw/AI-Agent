import { child, loadConfig } from "@/shared/index.js";

const log = child({ module: "evaluation" });

async function main() {
  loadConfig();
  log.info("evaluation stub — implement in stage 1");
  // TODO(stage-1): load golden-set.yaml → run pipeline → compute metrics
}

main().catch((err) => {
  log.error({ err }, "evaluation failed");
  process.exit(1);
});
