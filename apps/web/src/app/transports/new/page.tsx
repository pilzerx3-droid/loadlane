import type { Metadata } from "next";
import { TransportFormPage } from "../../../components/transport-pages";

export const metadata: Metadata = { title: "New transport" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <TransportFormPage />;
}
