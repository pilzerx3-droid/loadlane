import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { ThemeProvider } from "../components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Loadlane", template: "%s · Loadlane" },
  description: "Transport visibility, freight calculation and spot freight",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The proxy (src/proxy.ts) makes a nonce for every response; scripts need it to run (CSP).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: the theme script sets data-theme on <html> before React loads.
    <html lang="en-US" suppressHydrationWarning>
      <body>
        <ThemeProvider {...(nonce ? { nonce } : {})}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
