# Dedicated checkout host

This service is trusted payment software, separate from the app's per-user agent
VMs. No agent shell, tool, screenshot stream or debugging endpoint may access it.
The merchant session is imported with a one-time, two-minute upload capability;
the service credential never enters an agent VM.

Run `node scripts/bundle-private-checkout.mjs` to prepare a source bundle without
environment files. Use an Ubuntu 22.04 host with Node 24, the pinned npm packages,
Chrome's OS dependencies, iptables/ip6tables, and a TLS reverse proxy. Install the
source as root-owned files in `/opt/belna-checkout`, npm dependencies there, and
the supplied unit as `/etc/systemd/system/belna-checkout.service`.

Create the `belna-checkout` service account and `/var/lib/belna-checkout` with
0700 ownership. Keep `PRIVATE_CHECKOUT_TOKEN` in the root-owned, 0600 file
`/etc/belna-checkout.env`. Configure the same token and HTTPS origin only as
server secrets in Lovable. Neither a Whop key nor a Supabase key is needed here.
Never configure this host with the app's Azure agent VM credentials.

Puppeteer's Chrome cache belongs at `/opt/belna-checkout/chrome-cache`. The
launch uses Chrome's sandbox and a debugging pipe. Profiles live only in the
service's private `/run` directory and are removed on closure; disable swap and
core dumps on this dedicated host. Disable Chrome card autofill, password
saving, extensions, downloads and crash reporting through managed Chrome policy.

The unit installs a UID firewall before startup. Browser requests cannot reach
loopback, private networks, metadata or Azure's platform endpoint; IPv6 is
blocked. The only private exception is the host DNS resolver. TLS proxy replies
use established connections. Expose only ports 80/443 at the network boundary;
8020 and CDP ports must never be public. Do not log request bodies, authorization
headers, cookies, screenshots or importer URLs. Importer URLs are short-lived
capabilities and must also be removed from proxy access logs.

Verify authenticated `/health`, unauthenticated 401s, firewall denial from the
service UID, exact order refusal, duplicate refusal and owner isolation on the
deployed host. An interrupted private session cannot be resumed after restart;
the durable app-side reservation prevents retry, and Supabase recovery closes
the issuer card. Unknown outcomes require checking the merchant and wallet.

The generic checkout recognizer deliberately refuses ambiguous forms or totals.
An issuer card being usable where Visa is accepted is not a guarantee that every
merchant's web checkout can be automated. Processor frames, redirects, delayed
bank challenges, coupons, shipping variants and confirmations need live testing.
