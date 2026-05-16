import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { ToastProvider } from "@/shared/components";
import ReduxProvider from "@/core/store/Provider";
import ThemeProvider from "@/core/theme/ThemeProvider";
import "./globals.scss";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
    variable: "--font-jetbrains-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Logger",
    description: "Self-hosted log aggregation for software teams.",
};

const noFlashScript = `
(function () {
    var cookie = document.cookie.match(/logger_theme=([^;]+)/);
    var value = cookie ? cookie[1] : 'dark';
    var resolved = value === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : value;
    document.documentElement.dataset.theme = resolved;
})();
`.trim();

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            className={`${geistSans.variable} ${jetbrainsMono.variable}`}
            suppressHydrationWarning
        >
            <body>
                <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: noFlashScript }} />
                <ReduxProvider>
                    <ThemeProvider>
                        <ToastProvider>{children}</ToastProvider>
                    </ThemeProvider>
                </ReduxProvider>
            </body>
        </html>
    );
}
