import { NextResponse } from "next/server";

export async function GET() {
  const mask = (v?: string) => v ? v.slice(0, 6) + "…" + v.slice(-4) : "(absent)";
  return NextResponse.json({
    OPENAI_API_KEY: mask(process.env.OPENAI_API_KEY),
    INPI_API_KEY: mask(process.env.INPI_API_KEY),
    INPI_BASE: process.env.INPI_BASE,
    INPI_ACCEPT: process.env.INPI_ACCEPT,
    EUIPO_ENABLED: process.env.EUIPO_ENABLED,
    EUIPO_MOCK: process.env.EUIPO_MOCK,
  });
}