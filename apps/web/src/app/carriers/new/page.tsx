import type { Metadata } from "next";
import { MasterDataFormPage } from "../../../components/master-data-pages";

export const metadata: Metadata = { title: "Add carriers" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <MasterDataFormPage kind="carriers" />;
}
