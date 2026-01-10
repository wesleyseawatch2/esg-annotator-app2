import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "AI CUP 資料標註系統",
  description: "ESG 報告承諾驗證標註資料收集系統",
  icons: {
    icon: "/thumbnail.png",
  },
};

// Viewport 設定，優化手機版體驗
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // 確保內容延伸到安全區域 (瀏海/Home Bar)，這讓 CSS 中的 env(safe-area-inset-bottom) 能生效
  themeColor: "#ffffff",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}