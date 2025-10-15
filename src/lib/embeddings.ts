// src/lib/embeddings.ts
import OpenAI from "openai";

export async function embedText(text: string): Promise<number[] | null> {
  if (process.env.SEMANTIC_EMBEDDINGS === "false") {
    return null;
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim() === "") {
    console.error("❌ Missing OPENAI_API_KEY in .env");
    return null; // pas de clé => on skip proprement
  }
  try {
    const openai = new OpenAI({ apiKey: key });
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return res.data[0].embedding as unknown as number[];
  } catch (err: any) {
    if (err?.status === 429 || err?.code === "insufficient_quota") {
      return null;
    }
    console.error("embedText error", err?.status || err?.code, err?.message);
    return null;
  }
}