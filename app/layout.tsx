import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, JetBrains_Mono } from "next/font/google";
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

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    // Passed to <Script> explicitly rather than left to Next's automatic nonce
    // stamping: that only runs server-side, so the client render reconstructs
    // the tag without a nonce and React reports a hydration mismatch.
    // See proxy.ts for where the nonce is minted.
    const nonce = (await headers()).get("x-nonce") ?? undefined;

    return (
        <html
            lang="en"
            className={`${geistSans.variable} ${jetbrainsMono.variable}`}
            suppressHydrationWarning
        >
            <body>
                {/* A raw tag, not next/script: `beforeInteractive` buys nothing
                    for an inline snippet that already sits first in <body>.

                    suppressHydrationWarning is required, not cosmetic. Per the
                    CSP spec browsers *hide* the nonce attribute once the document
                    is parsed — reading it back from the DOM yields "" — so React's
                    hydration check compares its real nonce against "" and reports
                    a mismatch on every load. The script itself runs fine. */}
                <script
                    nonce={nonce}
                    suppressHydrationWarning
                    dangerouslySetInnerHTML={{ __html: noFlashScript }}
                />
                <ReduxProvider>
                    <ThemeProvider>
                        <ToastProvider>{children}</ToastProvider>
                    </ThemeProvider>
                </ReduxProvider>
            </body>
        </html>
    );
}
