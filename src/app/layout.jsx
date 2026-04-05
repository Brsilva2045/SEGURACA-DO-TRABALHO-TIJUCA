import "./globals.css";

export const metadata = {
  title: "Sistema SST • EPI",
  description: "Painel Next.js com Auth, Firestore, Storage e Cloud Functions no Firebase.",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
