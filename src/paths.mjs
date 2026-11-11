import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = join(ROOT, "data");
export const RAW = join(DATA, "raw");
export const DB_FILE = join(DATA, "knowledge.db");
export const KNOWLEDGE = join(ROOT, "knowledge");
export const REFERENCE = join(KNOWLEDGE, "reference");
export const GUIDE = join(KNOWLEDGE, "guide");
export const VENDOR = join(ROOT, "vendor");
export const AGENT_JAR = join(VENDOR, "agent.jar");
export const SCRIPTS = process.env.JUSTMC_SCRIPTS || join(ROOT, "mc-scripts");
export const WORKSPACE = process.env.JUSTMC_WORKSPACE || join(homedir(), ".justmc-mcp");
export const AGENT_HOME = join(WORKSPACE, "agent");
export const AGENT_FILE = join(AGENT_HOME, "session.json");
export const LINK_FILE = join(homedir(), ".xerocode", "link.json");
export const XERO_SOURCE = process.env.XERO_SOURCE || join(ROOT, "..", "justmc", "xero");
