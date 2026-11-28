import type { Metadata } from "next";
import { MasterDataFormPage } from "../../../components/master-data-pages";

export const metadata: Metadata = { title: "Edit locations" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const geo = typeof query["geo"] === "string" ? query["geo"] : undefined;
  return <MasterDataFormPage kind="locations" id={id} {...(geo ? { geoNotice: geo } : {})} />;
}
