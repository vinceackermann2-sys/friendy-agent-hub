# Belna/Lingon Azure VM sandbox

Each user gets **one dedicated Azure VM** for the agent’s computer: terminal, browser, code, files.
Microsoft Foundry calls stay on the Lingon server (the API key is never copied to the VM). Memory and vault stay in Lingon/Supabase.

## VM

- Name: `lingon-sb-<sha256(userId)[0:24]>`
- Size: `Standard_B2als_v2` (2 vCPU, 4 GB) · Ubuntu 22.04 · Sweden Central
- No public IP / SSH. Workspace: `/home/lingon/workspace` on the OS disk
- First boot installs Node 22 + Chromium plus Podman and the configured worker image via cloud-init
- The live browser uses a persistent Chromium CDP screencast relay. The VM makes one outbound, session-scoped `wss://` connection to Lingon; Canvas receives binary live frames and sends authenticated mouse/keyboard events back. The VM still has no inbound ports and no VNC/RDP/noVNC service.
- A private Blob screenshot is retained only as a compatibility fallback for deployments without `LINGON_PUBLIC_ORIGIN` (or `SITE_URL`).

## Lifecycle

- **Start** only when an agent actually needs shell, code, browser, or computer work. Opening the app and ordinary chat make a zero-compute status request.
- Shell and code run in a short-lived hardened Podman container inside the VM. The container has no network, no capabilities, a read-only root, resource limits, and only the task workspace mounted.
- Agent, background-task, and browser leases are renewed while active. After the last lease, the VM stays warm for `AZURE_VM_IDLE_MINUTES` (5 by default), then the sweeper snapshots state and deallocates it.
- Deallocation keeps the OS disk. The workspace and browser profile are also copied to private Blob storage and restored after VM replacement. Memory, secrets, chats, and documents remain in account storage.

## Cost (pay-as-you-go, Sweden Central, Linux B2als v2)

The [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) currently lists the Sweden Central Linux `Standard_B2als_v2` consumption meter at **$0.0389/hour**. Lingon meters VM runtime at a conservative **$0.06/hour** to cover compute and a storage allowance, then deducts 20 credits per metered dollar. That is **1.2 credits/hour** while running, including the five-minute idle grace. Set `AZURE_VM_BILLING_USD_PER_HOUR` for any other VM size or region.

The worker container runs inside that VM and does not create a second Container
Apps compute meter. Stopped VMs can still incur managed-disk, Blob, image, and
network charges. Verify current regional pricing before publishing a price.

| Usage | Approx. compute | Plus disk when stopped |
|---|---|---|
| Idle / deallocated | $0 | ~$1–3 / mo (30 GB Standard_LRS) |
| 2 hours/day | ~$2.33 / mo | + disk |
| Always on 24/7 | ~$28.40 / mo | compute already includes disk attach |

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
AZURE_VM_IDLE_MINUTES=5
AZURE_VM_BILLING_USD_PER_HOUR=0.06
AZURE_AUTO_PROVISION=true
# Optional; otherwise a deterministic Belna-only name is generated.
AZURE_STORAGE_ACCOUNT=
```

The runtime service principal needs `Virtual Machine Contributor`, `Network Contributor`, and `Storage Account Contributor`, scoped only to the Belna resource group. The storage role lets it create the private screenshot account/container and mint short-lived blob-specific SAS URLs; storage keys are never sent to the VM.

```
npm run azure:status
npm run azure:provision -- --create --user <lingonUserId>
```
