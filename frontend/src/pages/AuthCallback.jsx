import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

const AuthCallback = () => {
  const { completeGoogleLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const run = async () => {
      const hash = window.location.hash || "";
      const m = hash.match(/session_id=([^&]+)/);
      if (!m) {
        setError("Missing session_id from redirect");
        return;
      }
      try {
        await completeGoogleLogin(m[1]);
        // Clear the hash so a reload doesn't re-exchange.
        window.history.replaceState(null, "", "/");
        navigate("/", { replace: true });
      } catch (err) {
        setError(err?.response?.data?.detail || "Google sign-in failed");
      }
    };
    run();
    // eslint-disable-next-line
  }, []);

  return (
    <div className="min-h-screen grid place-items-center bg-background p-6" data-testid="auth-callback">
      <div className="card-white p-6 max-w-md w-full text-center">
        {error ? (
          <>
            <div className="font-bold text-danger text-[16px] mb-2">Sign-in failed</div>
            <p className="text-muted text-[13px] mb-4">{error}</p>
            <button
              className="px-3 py-1.5 rounded-lg bg-brand text-white text-[13px] font-semibold"
              onClick={() => navigate("/login", { replace: true })}
              data-testid="auth-callback-back"
            >
              Back to sign-in
            </button>
          </>
        ) : (
          <>
            <div className="animate-pulse font-semibold">Signing you in…</div>
            <p className="text-muted text-[12px] mt-1">Verifying your Google account</p>
          </>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
