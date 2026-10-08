import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PrivyProvider,
  usePrivy,
  useLoginWithEmail,
  useCreateWallet,
  getIdentityToken,
  useSyncJwtBasedAuthState,
  useAuthorizationSignature,
  useDepositFunds,
  useExportWallet,
} from "@privy-io/react-auth";
import { base } from "viem/chains";
import { assertReviewedRequest } from "./review-request";
import { WalletEmailVerification } from "./email-verification";

declare global {
  interface Window {
    LingonAuth: any;
    LingonConfig: any;
    BelnaPrivy: any;
  }
}
type WalletConfig = {
  appId: string;
  authMode: "email" | "jwt";
  configured: boolean;
  tokenAddress: string;
};
let operations: any, initializing: Promise<void> | undefined;
let authFailure: string | undefined;
let productionAppId = "";
let authenticate: (() => Promise<void>) | undefined;
const waiters = new Set<() => void>();
function JwtSync() {
  useSyncJwtBasedAuthState({
    subscribe: (notify) => {
      const changed = () => {
        authFailure = undefined;
        notify();
      };
      window.addEventListener("belna-auth-changed", changed);
      return () => window.removeEventListener("belna-auth-changed", changed);
    },
    getExternalJwt: async () => {
      if (!window.LingonAuth?.get()?.access_token) return undefined;
      await window.LingonAuth.api("/api/auth/me");
      return window.LingonAuth.get()?.access_token;
    },
    onError: () => {
      authFailure =
        "The wallet login connection is unavailable. Please try again later.";
      for (const fn of waiters) fn();
    },
  });
  return null;
}
function Bridge({ authMode }: { authMode: "email" | "jwt" }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const latestUser = useRef(user);
  latestUser.current = user;
  const { sendCode, loginWithCode } = useLoginWithEmail();
  type Verification = {
    owner: string;
    email: string;
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  const verification = useRef<Verification | undefined>(undefined);
  const [verificationEmail, setVerificationEmail] = useState<string | undefined>();
  const finishVerification = (error?: Error) => {
    const pending = verification.current;
    verification.current = undefined;
    setVerificationEmail(undefined);
    if (!pending) return;
    clearTimeout(pending.timer);
    error ? pending.reject(error) : pending.resolve();
  };
  const currentVerification = () => {
    const pending = verification.current;
    if (!pending || window.LingonAuth.get()?.user?.id !== pending.owner)
      throw Error("Your account changed. Reopen your wallet.");
    return pending;
  };
  const { createWallet } = useCreateWallet();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { depositFunds } = useDepositFunds(),
    { exportWallet } = useExportWallet();
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let previousOwner = window.LingonAuth.get()?.user?.id;
    const changed = () => {
      const nextOwner = window.LingonAuth.get()?.user?.id;
      // A token refresh for the same owner must not cancel an in-flight OTP.
      if (nextOwner === previousOwner) return;
      previousOwner = nextOwner;
      finishVerification(Error("Your account changed. Reopen your wallet."));
      operations = undefined;
      authenticate = undefined;
      authFailure = undefined;
      setEpoch((x) => x + 1);
    };
    window.addEventListener("belna-auth-changed", changed);
    return () => {
      window.removeEventListener("belna-auth-changed", changed);
      finishVerification(Error("Wallet verification closed."));
    };
  }, []);
  useEffect(() => {
    operations = undefined;
    authenticate = undefined;
    if (!ready) return;
    const account = window.LingonAuth.get()?.user,
      owner = account?.id,
      email = account?.email?.toLowerCase();
    const matches =
      !!owner &&
      !!user &&
      user.linkedAccounts.some((a: any) =>
        authMode === "jwt"
          ? a.type === "custom_auth" && a.customUserId === owner
          : a.type === "email" && a.address?.toLowerCase() === email,
      );
    authenticate = async () => {
      authFailure = undefined;
      if (!owner || !email) throw Error("Sign in to your confirmed Belna account first.");
      if (authMode === "email" && (!authenticated || !matches)) {
        if (authenticated) await logout();
        if (window.LingonAuth.get()?.user?.id !== owner)
          throw Error("Your account changed. Reopen your wallet.");
        if (verification.current) throw Error("Wallet email verification is already open.");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => finishVerification(Error("Wallet verification timed out. Reopen your wallet.")),
            300000,
          );
          verification.current = { owner, email, resolve, reject, timer };
          setVerificationEmail(email);
        });
      }
    };
    for (const fn of waiters) fn();
    if (!authenticated || !matches) return;
    const checkOwner = () => {
      if (window.LingonAuth.get()?.user?.id !== owner)
        throw Error("Your account changed. Reopen your wallet.");
    };
    const headers = async () => {
      checkOwner();
      const token = await getIdentityToken();
      if (!token) throw Error("Wallet ownership could not be verified. Please try again later.");
      return { "privy-id-token": token };
    };
    operations = {
      setup: async (country: string) => {
        checkOwner();
        let wallet: any = latestUser.current?.linkedAccounts.find(
          (a: any) =>
            a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "ethereum",
        );
        if (!wallet) {
          const created = await createWallet();
          checkOwner();
          wallet = latestUser.current?.linkedAccounts.find(
            (a: any) =>
              a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "ethereum",
          ) || created;
        }
        checkOwner();
        if (!wallet?.id)
          throw Error("Your embedded wallet could not be confirmed. Refresh and try again.");
        // This getter already refreshes both the user and identity token.
        // Calling refreshUser immediately before it hits the same endpoint
        // twice and can rate-limit an otherwise successful wallet creation.
        const identityToken = await getIdentityToken();
        checkOwner();
        if (!identityToken) throw Error("Wallet ownership could not be verified. Reopen your wallet.");
        return window.LingonAuth.api("/api/belna-wallet/setup", {
          method: "POST",
          body: JSON.stringify({
            country,
            walletId: wallet.id,
            identityToken,
          }),
        });
      },
      fund: async () => {
        checkOwner();
        const { wallet } = await window.LingonAuth.api("/api/belna-wallet");
        checkOwner();
        const result = await depositFunds({
          destination: {
            wallet: wallet.walletId,
            chain: "eip155:8453",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          },
          fiat: { source: { assets: ["eur", "usd"], defaultAsset: "eur" }, environment: "production", defaultAmount: "25" },
        });
        checkOwner();
        return result;
      },
      bank: async (action: "verify" | "register", input: any = {}) => {
        checkOwner();
        const result = await window.LingonAuth.api("/api/belna-wallet/bank/" + action, {
          method: "POST", headers: await headers(), body: JSON.stringify(input),
        });
        checkOwner();
        return result;
      },
      authorize: async (quoteId: string, riskAccepted = false) => {
        checkOwner();
        const h = await headers();
        const prepared = await window.LingonAuth.api("/api/belna-wallet/prepare", {
          method: "POST",
          headers: h,
          body: JSON.stringify({ quoteId, confirm: true, riskAccepted }),
        });
        checkOwner();
        if (!prepared.request) return prepared.intent;
        const { request, intent } = prepared;
        // Sign precisely what was reviewed. No raw model-supplied transaction can
        // reach the SDK, and no signing key is handed to the backend or agent.
        assertReviewedRequest(request, intent, quoteId, productionAppId);
        const { signature } = await generateAuthorizationSignature(request);
        checkOwner();
        return window.LingonAuth.api("/api/belna-wallet/authorize", {
          method: "POST",
          headers: await headers(),
          body: JSON.stringify({
            quoteId,
            signature,
            expiry: request.headers["privy-request-expiry"],
            confirm: true,
            riskAccepted,
          }),
        });
      },
      export: async () => {
        checkOwner();
        const { wallet } = await window.LingonAuth.api("/api/belna-wallet");
        checkOwner();
        await exportWallet({ address: wallet.address });
      },
    };
    for (const fn of waiters) fn();
    return () => {
      operations = undefined;
      authenticate = undefined;
    };
  }, [
    ready,
    authenticated,
    user,
    epoch,
    authMode,
    logout,
    createWallet,
    generateAuthorizationSignature,
    depositFunds,
    exportWallet,
  ]);
  return verificationEmail ? (
    <WalletEmailVerification
      email={verificationEmail}
      onCancel={() => finishVerification(Error("Wallet email verification was cancelled."))}
      sendCode={async () => {
        const pending = currentVerification();
        await sendCode({ email: pending.email });
        if (currentVerification() !== pending) throw Error("Wallet verification changed.");
      }}
      verifyCode={async (code) => {
        const pending = currentVerification();
        await loginWithCode({ code });
        if (currentVerification() !== pending) throw Error("Wallet verification changed.");
        finishVerification();
      }}
    />
  ) : null;
}
async function initialize() {
  const owner = window.LingonAuth.get()?.user?.id;
  if (!owner) throw Error("Sign in to your Belna account first.");
  authFailure = undefined;
  const checkOwner = () => {
    if (window.LingonAuth.get()?.user?.id !== owner)
      throw Error("Your account changed. Reopen your wallet.");
  };
  if (!initializing)
    initializing = (async () => {
      const response = await fetch(
        (window.LingonConfig?.apiBase || "") + "/api/belna-wallet/config",
        { cache: "no-store" },
      );
      const config: WalletConfig = await response.json();
      if (!response.ok || !config.configured || !config.appId)
        throw Error("The production wallet connection is not configured yet.");
      productionAppId = config.appId;
      const host = document.createElement("div");
      host.id = "belna-privy-sdk";
      document.body.append(host);
      createRoot(host).render(
        <>
          {/* Whitelabel only the vendor watermark; retain legal and owner-confirmation UIs. */}
          <style>{"#protected-by-privy { display: none !important; }"}</style>
          <PrivyProvider
            appId={config.appId}
            config={{
              appearance: {
                theme: "light",
                accentColor: "#bb2439",
                showWalletLoginFirst: false,
                logo: <span>Belna Wallet</span>,
              },
              defaultChain: base,
              supportedChains: [base],
              embeddedWallets: { ethereum: { createOnLogin: "off" }, showWalletUIs: true },
            }}
          >
            {config.authMode === "jwt" ? <JwtSync /> : null}
            <Bridge authMode={config.authMode} />
          </PrivyProvider>
        </>,
      );
    })().catch((e) => {
      initializing = undefined;
      throw e;
    });
  await initializing;
  checkOwner();
  if (operations) return;
  const wait = async (predicate: () => boolean, timeout: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(Error("Your wallet connection timed out. Reopen it and verify your Belna email."));
      }, timeout);
      const check = () => {
        if (predicate() || authFailure) {
          clearTimeout(timer);
          waiters.delete(check);
          authFailure ? reject(Error(authFailure)) : resolve();
        }
      };
      waiters.add(check);
      check();
    });
  await wait(() => !!authenticate, 25000);
  checkOwner();
  await authenticate!();
  await wait(() => !!operations, 120000);
  checkOwner();
}
window.BelnaPrivy = {
  setup: async (country: string) => {
    await initialize();
    return operations.setup(country);
  },
  fund: async () => {
    await initialize();
    return operations.fund();
  },
  authorize: async (id: string, risk = false) => {
    await initialize();
    return operations.authorize(id, risk);
  },
  bank: async (action: "verify" | "register", input: any = {}) => {
    await initialize();
    return operations.bank(action, input);
  },
  export: async () => {
    await initialize();
    return operations.export();
  },
};
