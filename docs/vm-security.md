# VM security controls

## Supported everyday work

Security controls apply at the execution boundary, not as a keyword refusal rule
for user requests. Public research, browser navigation and forms, approved vault
logins, connected apps, offline calculations/code, workspace file edits and
generated Library/Canvas documents remain supported. Routine actions retain the
existing permission policy; owner settings such as "always ask" still apply.

Requests mentioning the computer, desktop, file manager or text editor offer the
owner's computer (`computer_action`, see below) alongside browser, code and
Library tools; spreadsheet requests get code and Library tools. Download/export
requests offer public text/CSV/JSON reading and Library output; this does not
enable arbitrary browser file downloads, binary imports or package installation
from the network. The agent is told
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

The computer (computer use) is the OS-enforced boundary this document required
before a desktop could return: a file manager, editor or window manager can start
programs, so the entire desktop runs inside one container and none of it runs on
the VM itself (`buildDesktopSessionScript` in `server/agents/azure-vm.js`):

- Rootless podman under the unprivileged `lingon-desktop` account. Container users
  map to that account's subordinate ids (524288+), so an escape from the container
  lands in an account with no rights on the VM. The image is built by root, like the
  worker image, and loaded into that account's storage (`/var/lib/lingon-desktop/storage`).
- Everything in it (screen, window manager, Chromium, file manager, text editor and
  the streamer) is one process tree: all capabilities dropped (none effective, permitted
  or bounding), no new privileges, a read-only image with every setuid/setgid bit
  removed and no terminal, private PID/IPC/UTS namespaces, and memory (2 GB), CPU
  (1.5) and task (768) limits on its systemd scope. Its seccomp profile is podman's
  default plus `chroot` (`/etc/lingon/desktop-seccomp.json`): podman only allows chroot
  to holders of CAP_SYS_CHROOT, and Chromium's sandbox chroots inside its own user
  namespace. A capability instead would have been effective for the desktop user.
- The only VM folders it sees are its own home, `/var/lib/lingon-desktop/home`
  (owned by the container's user, mounted noexec/nosuid/nodev; its files and its
  browser profile, saved with the VM backup), and the session's streamer code,
  read-only. It never sees the workspace, the protected browser's profile or `/run`.
- Its network goes through slirp4netns, which runs as `lingon-desktop`, so the same
  firewall as the protected browser applies: public TCP 80/443 only; private,
  metadata, platform and IPv6 destinations are rejected; host loopback is closed.
  DNS goes through slirp4netns to the VM's local resolver.
- Chromium keeps its own sandbox (seccomp and its own user namespace) and the same
  policies; if it cannot get a sandbox inside the container, it stays closed.
- Agent steps arrive over the session's own live channel (separate from the browser's)
  and run only when signed with the key the server gave the container at launch.
  Results go to one-time private upload links. Vault values are never sent to the
  computer: saved logins are typed only in the protected browser. The owner's input
  applies only after they take over in the live view. Apps get a clean environment
  without the launch payload. One desktop runs per VM; it exits after 20 idle minutes.
  Steps name the server's desktop build; a container from another build ignores them,
  so the next step replaces it (an update reaches running desktops at once).
- Steps are signed over a canonical form with sorted keys (`signStep`): Realtime
  forwards objects with their keys re-sorted, so a signature over the sent text only
  held for one-field events. This applies to the protected browser's streamer too.

Live acceptance on a fresh VM (Ubuntu 22.04, podman 3.4.4, kernel 6.8), 2026-09-30:
from inside the desktop container, metadata, the platform endpoint, the VM's private
address, private networks, host loopback, UDP, non-web ports and IPv6 were all
unreachable, public HTTPS worked with DNS; the image and /etc were read-only, programs
written to home or /tmp could not run, no setuid program or VM folder was visible,
all capability sets were zero, and Chromium's renderers ran under seccomp in their own
user namespace. On the VM, desktop processes ran as subordinate id 525287, the scope
limits were in force, neither service account had sudo or a shell, and the desktop
account could not read the workspace or the browser profile. The protected browser's
account reached public HTTPS but not metadata, the platform endpoint or SSH, and its
renderers ran sandboxed; the worker had no network and no capabilities. The same test
found and fixed: podman 3.4 rejecting `--pull=missing` (the worker image never built on
new VMs), `rm -t` and tmpfs `uid=`; rootless podman failing from the command runner's
root-only folder; the signature problem above; and a print service (cupsd, from the
Chromium snap) listening on port 631, which the firewall setup now stops and new VMs
no longer install.

The old native desktop relay stays closed on every path, and any native desktop
process left by an older release is ended when a firewall is set up.

Deploy both server runtimes together. For existing VMs, end running sessions and
restart the VM before allowing access so no old relay keeps handling input.
Browser hardening applies on the next protected browser startup; merely changing
source files does not harden an already-running VM. Existing downloaded files are
not scanned or cleaned by this change.

Validation: `node tests/vm-security.cjs`, `node tests/azure-vm.cjs`,
`node tests/azure-vm-esm.mjs`, `node tests/browser-profile.cjs`, and
`node tests/live-stream.cjs`. Run a live Azure acceptance test after deployment
for firewall installation, sandbox availability, download attempts (including
popups/blob URLs), and private/metadata reachability. For the computer, the
acceptance test also checks from inside the desktop container: the metadata
endpoint, the VM's private address, the platform endpoint and host loopback are
unreachable, public HTTPS works, the container user has no capabilities and cannot
write outside its home and /tmp, and the desktop browser starts with its sandbox.
Keep the guest kernel,
browser and container runtime patched. No sandbox offers a guarantee against
all malware or unknown kernel/browser escape vulnerabilities. Public browsing
still retrieves website scripts and media; file-download denial is not a malware
scanner or a reputation filter for every site.
