import type { Metadata } from "next";
import { TransportImportPage } from "../../../components/transport-pages";

export const metadata: Metadata = { title: "Import transports" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <TransportImportPage />;
}
