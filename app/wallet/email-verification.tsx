import React, { useEffect, useRef, useState } from "react";

type Props = {
  email: string;
  sendCode: () => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  onCancel: () => void;
};

// OTPs stay in this owner-only form. They never enter chat, storage or analytics.
export function WalletEmailVerification({ email, sendCode, verifyCode, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true),
    busy = useRef(false);
  const [code, setCode] = useState(""),
    [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      active.current = false;
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const run = async (operation: () => Promise<void>, message: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await operation();
    } catch {
      if (active.current) setError(message);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  };
  const send = () =>
    run(async () => {
      await sendCode();
      if (active.current) {
        setSent(true);
        setCode("");
      }
    }, "We could not send a code. Please wait a moment and try again.");
  return (
    <>
      <style>{`
      #belna-wallet-verification{box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #ebe4e2;border-radius:24px;padding:30px;background:#fffcfa;color:#302924;box-shadow:0 24px 80px #30292433;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #belna-wallet-verification::backdrop{background:#201c2759;backdrop-filter:blur(4px)}
      #belna-wallet-verification h2{font-size:24px;line-height:1.2;margin:12px 0}
      #belna-wallet-verification p{margin:12px 0;color:#6b635e;overflow-wrap:anywhere}
      #belna-wallet-verification label{display:block;margin:20px 0 8px;font-weight:600}
      #belna-wallet-verification input{box-sizing:border-box;width:100%;border:1px solid #d9d0cc;border-radius:12px;padding:12px;font-family:inherit;font-size:22px;line-height:1.4;letter-spacing:5px;background:white;color:#302924}
      #belna-wallet-verification button{width:100%;border:0;border-radius:12px;padding:12px 14px;margin-top:12px;font-family:inherit;font-size:15px;font-weight:600;line-height:1.4;cursor:pointer;color:white;background:#bb2439}
      #belna-wallet-verification button.secondary{background:#f0ebe7;color:#514a46}
      #belna-wallet-verification button:disabled{opacity:.55;cursor:wait}
      #belna-wallet-verification :focus-visible{outline:3px solid #bb243980;outline-offset:3px}
      #belna-wallet-verification [role=alert]{color:#aa2439}
    `}</style>
      <dialog
        id="belna-wallet-verification"
        ref={dialog}
        aria-labelledby="belna-wallet-verification-title"
        onCancel={(event) => {
          event.preventDefault();
          onCancel();
        }}
      >
        <strong style={{ color: "#bb2439", fontSize: 17 }}>Belna Wallet</strong>
        <h2 id="belna-wallet-verification-title">Verify your wallet email</h2>
        <p>
          {sent ? "Enter the code sent to" : "We’ll send a verification code to"}{" "}
          <strong>{email}</strong>.
        </p>
        <p>Your wallet stays connected to your Belna account.</p>
        {sent ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!/^\d{6}$/.test(code)) return;
              void run(
                () => verifyCode(code),
                "That code could not be verified. Try again or request a new code.",
              );
            }}
          >
            <label htmlFor="belna-wallet-email-code">Email code</label>
            <input
              id="belna-wallet-email-code"
              name="wallet-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              disabled={pending}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button type="submit" disabled={pending || code.length !== 6}>
              {pending ? "Please wait…" : "Verify and continue"}
            </button>
            <button type="button" className="secondary" disabled={pending} onClick={send}>
              Send a new code
            </button>
          </form>
        ) : (
          <button type="button" disabled={pending} onClick={send}>
            {pending ? "Sending…" : "Send verification code"}
          </button>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </dialog>
    </>
  );
}
