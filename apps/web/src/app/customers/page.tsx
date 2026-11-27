import type { Metadata } from "next";
import { MasterDataListPage } from "../../components/master-data-pages";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <MasterDataListPage kind="customers" searchParams={searchParams} />;
}
