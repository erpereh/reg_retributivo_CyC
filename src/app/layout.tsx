import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeScript } from "@/components/theme/ThemeScript";
import "./globals.css";
import "./theme-overrides.css";
import "./dark-accent-overrides.css";
import "./shell-v2.css";
import "./dashboard-v2.css";
import "./settings-v2.css";
import "./common-v2.css";
import "./cuadre-v2.css";
import "./assistant-v2.css";
import "./reference-ui.css";
import "./assistant-clone.css";

const body = Fira_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
});

const mono = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Registro Retributivo",
  description: "Aplicación profesional para validar recibos y el Registro Retributivo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${body.variable} ${mono.variable} font-sans antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
