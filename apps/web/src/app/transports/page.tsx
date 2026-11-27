import type { Metadata } from "next";
import { TransportsListPage } from "../../components/transport-pages";

export const metadata: Metadata = { title: "Transports" };
export const dynamic = "force-dynamic";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <TransportsListPage searchParams={searchParams} />;
}
