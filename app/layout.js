import "./theme.css";
import "./globals.css";

export const metadata = {
  title: "RapidMoney CRM — Support Portal",
  description: "Email-to-ticket support portal for RapidMoney",
};

// UI v2 (see docs/ui-v2.md). Runs before first paint so the dark theme and
// the v2 font slot apply without a flash. Build-time half of the flag is
// inlined here; the per-user kill switch is localStorage "mh_ui_classic".
// Everything is inline — no external script, no telemetry.
const UI_V2_ENV = process.env.NEXT_PUBLIC_UI_V2 !== "0";
const PRE_PAINT = `(function(){try{var v2=${UI_V2_ENV ? "true" : "false"};var ls=window.localStorage;if(v2&&ls&&ls.getItem("mh_ui_classic")==="1")v2=false;var d=document.documentElement;if(v2){d.setAttribute("data-ui","v2");var t=ls?ls.getItem("mh_theme"):null;if(t==="dark"||t==="light")d.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
