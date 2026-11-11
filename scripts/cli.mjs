import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/paths.mjs";

const [tool, input, shotFile] = process.argv.slice(2);
if (!tool) {
  console.error('node scripts/cli.mjs <инструмент> \'{"json":"аргументы"}\'|@файл.json [снимок.png]');
  process.exit(2);
}
const args = !input ? {} : input.startsWith("@") ? JSON.parse(readFileSync(input.slice(1), "utf8")) : JSON.parse(input);
const client = new Client({ name: "cli", version: "1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "src", "index.mjs")], stderr: "ignore" }));
const r = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 600000 });
for (const part of r.content) {
  if (part.type === "text") console.log(part.text);
  else if (shotFile) writeFileSync(shotFile, Buffer.from(part.data, "base64"));
  else console.log(`[${part.type}]`);
}
await client.close();
process.exit(r.isError ? 1 : 0);
