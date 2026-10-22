"use server";

import { revalidatePath } from "next/cache";
import {
  clearUnpinnedConversations,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  toggleConversationPin,
  type ChatKind,
} from "@/lib/chat-store";
import type { ChatConversation, ChatMessage } from "@/db/schema";
import { guardAction } from "@/lib/action-guard";

export async function fetchChats(opts: {
  kind?: ChatKind;
  clientId?: number | null;
  limit?: number;
}): Promise<ChatConversation[]> {
  await guardAction("read", opts?.clientId);
  return listConversations(opts);
}

export async function fetchChat(
  id: number,
): Promise<{ conversation: ChatConversation; messages: ChatMessage[] } | null> {
  await guardAction("read");
  return getConversation(id);
}

export async function deleteChat(id: number) {
  await guardAction("edit");
  await deleteConversation(id);
  revalidatePath("/chats");
  revalidatePath("/seo-chat");
  revalidatePath("/ask");
}

export async function pinChat(id: number) {
  await guardAction("edit");
  await toggleConversationPin(id);
  revalidatePath("/chats");
}

export async function renameChat(id: number, formData: FormData) {
  await guardAction("edit", formData.get("clientId"));
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await renameConversation(id, title);
  revalidatePath("/chats");
}

export async function clearChats(kind?: ChatKind) {
  await guardAction("edit");
  const n = await clearUnpinnedConversations({ kind });
  revalidatePath("/chats");
  return n;
}
