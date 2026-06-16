import path from "node:path";
import type { CreateMessageInput, Message } from "../domain/message.js";
import { createId, sanitizeId } from "../domain/ids.js";
import { ensureDir, listFiles, readYaml, writeYaml } from "./fs-utils.js";
import type { OlapPaths } from "./paths.js";

export class MessageStore {
  constructor(private readonly paths: OlapPaths) {}

  private filePath(id: string): string {
    return path.join(this.paths.messages, `${sanitizeId(id)}.json`);
  }

  async ensure(): Promise<void> {
    await ensureDir(this.paths.messages);
  }

  async create(input: CreateMessageInput): Promise<Message> {
    await this.ensure();
    const message: Message = {
      id: createId("message"),
      from_agent: input.from_agent,
      to_agent: input.to_agent,
      channel: input.channel ?? (input.to_agent ? "direct" : "broadcast"),
      subject: input.subject,
      body: input.body,
      task_id: input.task_id,
      status: "delivered",
      created_at: new Date().toISOString(),
    };
    await writeYaml(this.filePath(message.id), message);
    return message;
  }

  async list(): Promise<Message[]> {
    const files = await listFiles(this.paths.messages, ".json");
    const messages = await Promise.all(files.map((f) => readYaml<Message>(f)));
    return messages
      .filter((m): m is Message => m !== null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async forAgent(agentId: string): Promise<Message[]> {
    const all = await this.list();
    return all.filter(
      (m) =>
        m.to_agent === agentId ||
        m.from_agent === agentId ||
        (m.channel === "broadcast" && m.to_agent === undefined),
    );
  }
}