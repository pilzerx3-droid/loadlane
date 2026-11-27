import type { Metadata } from "next";
import { TransportDetailPage } from "../../../components/transport-pages";

export const metadata: Metadata = { title: "Transport" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const problem = (await searchParams)["problem"];
  return <TransportDetailPage id={id} problem={typeof problem === "string" ? problem : ""} />;
}
