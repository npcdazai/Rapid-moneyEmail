import "./theme.css";
import "./globals.css";

export const metadata = {
  title: "QuickMoney CRM — Support Portal",
  description: "Email-to-ticket support portal for QuickMoney",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
