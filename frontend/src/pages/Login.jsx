import React from "react";
import { Button } from "@/components/ui/button";
import { LogIn, ShieldAlert } from "lucide-react";
import { useSearchParams } from "react-router-dom";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function Login() {
  const [params] = useSearchParams();
  const errorMsg = params.get("error");

  const handleLogin = () => {
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href =
      "https://auth.emergentagent.com/?redirect=" + encodeURIComponent(redirectUrl);
  };

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-[var(--vivo-bg)]" data-testid="login-page">
      {/* Left: editorial image — sourced from vivofashiongroup.com */}
      <div className="relative hidden lg:block">
        <img
          src="https://vivofashiongroup.com/cdn/shop/files/April_New_Styles_AD_1920.jpg?v=1775813786"
          alt="Vivo Fashion editorial campaign"
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
          data-testid="login-hero-image"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0F4D31]/35 via-[#0F4D31]/45 to-[#0F4D31]/75" />
        <div className="absolute top-10 left-12 right-12 text-white/90">
          <div className="grid grid-cols-3 gap-2">
            {[
              "https://vivofashiongroup.com/cdn/shop/files/April_New_styles_Web.jpg?v=1775812820",
              "https://vivofashiongroup.com/cdn/shop/files/Dress_to_Impress_Website_SZ.jpg?v=1777361803",
              "https://vivofashiongroup.com/cdn/shop/files/N_January_Dresses_vivo.jpg?v=1770994218",
            ].map((src, i) => (
              <img key={i} src={src} alt="" referrerPolicy="no-referrer" className="h-20 w-full object-cover rounded-sm ring-1 ring-white/30 shadow-lg" />
            ))}
          </div>
        </div>
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <div className="eyebrow text-[var(--vivo-gold)] mb-3">VIVO · CLIENTELING</div>
          <h2 className="font-display text-4xl xl:text-5xl leading-tight max-w-lg">
            Tools that turn associates into trusted personal stylists.
          </h2>
          <p className="mt-6 max-w-md text-white/85">
            Customer profiles, follow-ups, lookbooks and WhatsApp messaging — designed
            for the shop floor.
          </p>
        </div>
      </div>

      {/* Right: sign-in */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-6">
            <span className="vivo-logo-tile text-2xl" aria-hidden="true">Vivo</span>
            <div>
              <div className="font-bold tracking-tight text-[15px]">Vivo Fashion Group</div>
              <div className="text-[11px] text-[var(--vivo-muted)] uppercase tracking-[0.2em]">Clienteling · East Africa</div>
            </div>
          </div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight">Sign in</h1>
          <div className="gold-rule my-6" />
          <p className="text-[var(--vivo-muted)] mb-10 leading-relaxed">
            Use your Vivo Google account to access the clienteling workspace.
            New associates are activated automatically by your manager.
          </p>

          {errorMsg && (
            <div
              data-testid="login-error-banner"
              className="mb-6 p-4 rounded-sm border border-red-200 bg-red-50 text-red-800 flex items-start gap-3"
            >
              <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">Sign-in blocked</div>
                <div className="text-sm mt-1 leading-relaxed">{errorMsg}</div>
              </div>
            </div>
          )}

          <Button
            onClick={handleLogin}
            data-testid="login-google-button"
            className="w-full h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-md text-base font-semibold"
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
