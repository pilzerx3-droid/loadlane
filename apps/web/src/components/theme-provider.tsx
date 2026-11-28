"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Light, dark or the system setting. The choice is remembered in the browser. `nonce` is the
 * Content Security Policy nonce of this response: the small script that sets the theme before the
 * page paints only runs because it carries it.
 */
export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...(nonce ? { nonce } : {})}
    >
      {children}
    </NextThemesProvider>
  );
}
