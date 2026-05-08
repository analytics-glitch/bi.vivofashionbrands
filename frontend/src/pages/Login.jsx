import React from "react";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function Login() {
  const handleLogin = () => {
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href =
      "https://auth.emergentagent.com/?redirect=" + encodeURIComponent(redirectUrl);
  };

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-[var(--vivo-bg)]" data-testid="login-page">
      {/* Left: editorial image */}
      <div className="relative hidden lg:block">
        <img
          src="https://images.unsplash.com/photo-1770061072353-32cc5837c28d?crop=entropy&cs=srgb&fm=jpg&q=85"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-[#1F3864]/40" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <div className="eyebrow text-[var(--vivo-gold)] mb-3">VIVO · CLIENTELING</div>
          <h2 className="font-display text-4xl xl:text-5xl leading-tight max-w-lg">
            Tools that turn associates into trusted personal stylists.
          </h2>
          <p className="mt-6 max-w-md text-white/80">
            Customer profiles, follow-ups, lookbooks and WhatsApp messaging — designed
            for the shop floor.
          </p>
        </div>
      </div>

      {/* Right: sign-in */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="eyebrow mb-3">VIVO · FASHION GROUP</div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight">Sign in</h1>
          <div className="gold-rule my-6" />
          <p className="text-[var(--vivo-muted)] mb-10 leading-relaxed">
            Use your Vivo Google account to access the clienteling workspace.
            New associates are activated automatically by your manager.
          </p>

          <Button
            onClick={handleLogin}
            data-testid="login-google-button"
            className="w-full h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm text-base font-medium"
          >
            <LogIn className="mr-2 h-4 w-4" />
            Continue with Google
          </Button>

          <p className="mt-8 text-xs text-[var(--vivo-muted)] leading-relaxed">
            By continuing, you accept the Vivo Fashion Group acceptable-use policy and
            confirm any customer data you create complies with the Kenya Data Protection Act 2019.
          </p>
        </div>
      </div>
    </div>
  );
}
