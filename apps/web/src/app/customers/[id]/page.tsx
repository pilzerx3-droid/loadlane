import type { Metadata } from "next";
import { MasterDataFormPage } from "../../../components/master-data-pages";

export const metadata: Metadata = { title: "Edit customers" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MasterDataFormPage kind="customers" id={id} />;
}
