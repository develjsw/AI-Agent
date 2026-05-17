import { loadConfig } from "@/shared/index.js";
import { routeQuestion } from "../router.js";

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('usage: pnpm router "질문..."');
    process.exit(2);
  }
  const config = loadConfig();
  const result = await routeQuestion(config, question, { model: config.CHAT_MODEL });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
