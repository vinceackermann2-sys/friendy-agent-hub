# VM security controls

## Supported everyday work

Security controls apply at the execution boundary, not as a keyword refusal rule
for user requests. Public research, browser navigation and forms, approved vault
logins, connected apps, offline calculations/code, workspace file edits and
generated Library/Canvas documents remain supported. Routine actions retain the
existing permission policy; owner settings such as "always ask" still apply.

Tool discovery excludes disabled native desktop tools. Requests mentioning the
computer, editor or spreadsheet offer browser, code and Library tools instead.
Download/export requests offer public text/CSV/JSON reading and Library output;
this does not enable arbitrary browser file downloads, binary imports, package
installation from the network or native desktop applications. The agent is told
to use supported routes, preserve the owner's intent, handle truncated reads and
report a specific unsupported step honestly instead of refusing the whole task.
Generated Library files remain available through the app's existing file flow.

Regression coverage: `node tests/agent-safe-workflows.cjs` verifies discovery,
safe tool dispatch, CSV output and permission behavior. Its execution/storage
checks use mocked services; `tests/browser-use.cjs` additionally exercises normal
page interactions on local Chrome. These checks do not prove that every website,
document format or user request can be completed.

User-controlled shell and code execute only in the worker container: no network,
no capabilities, no privilege escalation, a read-only root, private PID/IPC/UTS
namespaces, resource limits, and a bounded execution time. The only writable host
mount is the workspace. Root setup opens workspace directories without following
symlinks and stops on failure. Arbitrary programs can still be written and run
inside that container; these controls contain execution rather than classify code
as safe or malicious.

The browser runs as a separate unprivileged account. Browser-wide CDP download
denial is mandatory for new and reused browsers, including popup/blob downloads.
Unsupported download protection stops the operation. Browser reuse rejects flags
that disable sandbox or web security; launch never retries without the sandbox.
Root-owned policies additionally block downloads, extensions, developer tools,
file selection, and access to local files. CDP download denial is the primary
download control because headless browser policy support can vary.

Before browser startup, the host firewall blocks private, metadata, reserved and
IPv6 destinations. Public traffic is limited to TCP ports 80 and 443; loopback is
needed for the browser controller and local DNS resolver. Other host accounts
cannot connect to the browser's loopback TCP control service. Browser control
scripts and relay PID/log files live under root-owned `/run/lingon`, separate from
browser-writable state.

Native desktop startup is disabled, including direct provider calls, because a
file manager/editor/window manager can launch commands outside the worker
container. Existing desktop processes are terminated when browser firewall setup
runs. Reintroducing this feature requires an OS-enforced isolation boundary for
the entire desktop, not just an app or keyboard allowlist.

Deploy both server runtimes together. For existing VMs, end running sessions and
restart the VM before allowing access so no old relay keeps handling input.
Browser hardening applies on the next protected browser startup; merely changing
source files does not harden an already-running VM. Existing downloaded files are
not scanned or cleaned by this change.

Validation: `node tests/vm-security.cjs`, `node tests/azure-vm.cjs`,
`node tests/azure-vm-esm.mjs`, `node tests/browser-profile.cjs`, and
`node tests/live-stream.cjs`. Run a live Azure acceptance test after deployment
for firewall installation, sandbox availability, download attempts (including
popups/blob URLs), and private/metadata reachability. Keep the guest kernel,
browser and container runtime patched. No sandbox offers a guarantee against
all malware or unknown kernel/browser escape vulnerabilities. Public browsing
still retrieves website scripts and media; file-download denial is not a malware
scanner or a reputation filter for every site.
