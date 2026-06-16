export type MessageChannel = "direct" | "team" | "broadcast";
export type MessageStatus = "pending" | "delivered" | "read";

export interface Message {
  id: string;
  from_agent: string;
  to_agent?: string;
  channel: MessageChannel;
  subject: string;
  body: string;
  task_id?: string;
  status: MessageStatus;
  created_at: string;
}

export interface CreateMessageInput {
  from_agent: string;
  to_agent?: string;
  channel?: MessageChannel;
  subject: string;
  body: string;
  task_id?: string;
}