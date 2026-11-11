import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE } from "../paths.mjs";

const INLINE_IMAGE_LIMIT = 8_000_000;
const SHOTS = join(WORKSPACE, "shots");

export const text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }],
});

export const failure = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

export const image = (data) => ({ type: "image", data, mimeType: "image/png" });

export function images(list) {
  const inline = [];
  const saved = [];
  let size = 0;
  list.forEach((data, i) => {
    size += data.length;
    if (size <= INLINE_IMAGE_LIMIT) {
      inline.push(image(data));
      return;
    }
    mkdirSync(SHOTS, { recursive: true });
    const file = join(SHOTS, `${Date.now()}-${i}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    saved.push(file);
  });
  return { inline, saved };
}

export function register(server, name, spec, handler) {
  const { title, description, schema = {}, readOnly, destructive, openWorld } = spec;
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: schema,
      annotations: {
        title,
        ...(readOnly === undefined ? {} : { readOnlyHint: readOnly }),
        ...(destructive === undefined ? {} : { destructiveHint: destructive }),
        ...(openWorld === undefined ? {} : { openWorldHint: openWorld }),
      },
    },
    async (args) => {
      try {
        const result = await handler(args ?? {});
        return result?.content ? result : text(result ?? "готово");
      } catch (e) {
        return failure(e?.message ?? String(e));
      }
    },
  );
}

export const clip = (value, max = 24000) => {
  const s = String(value);
  return s.length <= max ? s : `${s.slice(0, max)}\n… обрезано, всего ${s.length} символов`;
};

export const fence = (code) => `\`\`\`kotlin\n${code}\n\`\`\``;
