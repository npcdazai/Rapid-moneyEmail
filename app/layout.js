import "./globals.css";

export const metadata = {
  title: "RapidMoney CRM — Support Portal",
  description: "Email-to-ticket support portal for RapidMoney",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
