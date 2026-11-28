import type { Metadata } from "next";
import { TransportFormPage } from "../../../components/transport-pages";

export const metadata: Metadata = { title: "New transport" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const quote = typeof params["quote"] === "string" ? params["quote"] : undefined;
  return <TransportFormPage {...(quote ? { quoteId: quote } : {})} />;
}
