import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/shared/components";
import ReduxProvider from "@/core/store/Provider";
import ThemeProvider from "@/core/theme/ThemeProvider";
import "./globals.scss";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
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
            className={`${geistSans.variable} ${geistMono.variable}`}
            suppressHydrationWarning
        >
            {/* dangerouslySetInnerHTML on <head> prevents React from reconciling
                its children, so the <script> is never seen as a JSX element —
                no React 19 "script tag" warning. Next.js metadata API injects
                its own tags outside this reconciliation path. */}
            {/* eslint-disable-next-line react/no-danger */}
            <head dangerouslySetInnerHTML={{ __html: `<script>${noFlashScript}</script>` }} />
            <body>
                <ReduxProvider>
                    <ThemeProvider>
                        <ToastProvider>{children}</ToastProvider>
                    </ThemeProvider>
                </ReduxProvider>
            </body>
        </html>
    );
}
