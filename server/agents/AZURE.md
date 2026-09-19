# Belna/Lingon Azure VM sandbox

Each user gets **one dedicated Azure VM** for the agent’s computer: terminal, browser, code, files.
Gemini 3.5 stays on the Lingon server (API key never copied to the VM). Memory and vault stay in Lingon/Supabase.

## VM

- Name: `lingon-sb-<sha256(userId)[0:24]>`
- Size: `Standard_B2als_v2` (2 vCPU, 4 GB) · Ubuntu 22.04 · Sweden Central
- No public IP / SSH. Workspace: `/home/lingon/workspace` on the OS disk
- First boot installs Node 22 + Chromium via cloud-init
- Browser frames are uploaded to a private Blob container with a blob-specific, five-minute SAS, fetched by Lingon, and deleted immediately. The VM still has no inbound ports.

## Lifecycle

- **Start** automatically when the Belna app opens, an agent turn runs, or a browser session starts.
- The app sends a short-lived per-user lease heartbeat while it is open; agent and browser leases are renewed while active.
- **Deallocate** as soon as the last lease is released or expires (with the idle sweep as a recovery backstop).
- Deallocate keeps the disk. Next start restores files. Memory/secrets are not on the disk.

## Cost (pay-as-you-go, Sweden Central, Linux B2als v2)

Retail meter (Oct 2025): **$0.0432 / hour** while running.

| Usage | Approx. compute | Plus disk when stopped |
|---|---|---|
| Idle / deallocated | $0 | ~$1–3 / mo (30 GB Standard_LRS) |
| 2 hours/day | ~$2.60 / mo | + disk |
| Always on 24/7 | ~$31.50 / mo | compute already includes disk attach |

Windows SKU is more; we use Linux. Prices change — check Azure retail prices.

## Configure

```
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_SUBSCRIPTION_ID=
AZURE_RESOURCE_GROUP=
AZURE_LOCATION=swedencentral
AZURE_VM_SIZE=Standard_B2als_v2
AZURE_VM_IDLE_MINUTES=30
AZURE_AUTO_PROVISION=true
# Optional; otherwise a deterministic Belna-only name is generated.
AZURE_STORAGE_ACCOUNT=
```

The runtime service principal needs `Virtual Machine Contributor`, `Network Contributor`, and `Storage Account Contributor`, scoped only to the Belna resource group. The storage role lets it create the private screenshot account/container and mint short-lived blob-specific SAS URLs; storage keys are never sent to the VM.

```
npm run azure:status
npm run azure:provision -- --create --user <lingonUserId>
```
