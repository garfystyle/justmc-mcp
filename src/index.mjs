#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { KNOWLEDGE } from "./paths.mjs";
import { Knowledge } from "./knowledge/store.mjs";
import { connected } from "./game/agent.mjs";
import { releaseAll } from "./game/player.mjs";
import { stopAll } from "./game/scripts.mjs";
import { registerCode } from "./tools/code.mjs";
import { registerGame } from "./tools/game.mjs";
import { registerKnowledge } from "./tools/knowledge.mjs";

const instructions = readFileSync(join(KNOWLEDGE, "instructions.md"), "utf8");
const knowledge = new Knowledge();
const server = new McpServer({ name: "justmc", version: "1.1.0" }, { instructions });

registerKnowledge(server, knowledge);
registerCode(server, knowledge);
registerGame(server);

for (const g of knowledge.guides()) {
  server.registerResource(
    `guide-${g.topic}`,
    `justmc://guide/${g.topic}`,
    { title: g.title, mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: g.text }] }),
  );
}

server.registerPrompt(
  "code",
  {
    title: "Написать и проверить код JustMC",
    description: "Пишет код на Xero под задачу и сам проверяет его в игре",
    argsSchema: { task: z.string().describe("Что должно работать в мире") },
  },
  ({ task }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `${knowledge.guides().find((g) => g.topic === "start")?.text ?? ""}\n\nЗадача: ${task}\n\nНачни с ask по задаче. Напиши читаемый код на Xero (тема style), доведи check до чистого результата, в том числе раздел «Читаемость», и проверь в игре инструментом test со сценарием, который доказывает, что всё работает. Если тест упал, исправь и повтори.`,
      },
    }],
  }),
);

const transport = new StdioServerTransport();

async function shutdown() {
  stopAll();
  if (connected()) await releaseAll().catch(() => {});
  process.exit(0);
}

transport.onclose = shutdown;
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(transport);
console.error("[justmc-mcp] готов");
