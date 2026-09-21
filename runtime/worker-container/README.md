# VM worker image

This image is the inner execution layer for shell and code tools. It is
started by the per-user Azure VM with a read-only root filesystem, no network,
no Linux capabilities, resource limits, and only the task workspace mounted.

For production, build and pin this image in the registry available to the VM,
then set `AZURE_WORKER_IMAGE` to its immutable tag or digest. The VM bootstrap
can build the same Dockerfile locally when the default `localhost/` tag is
used; pre-building is faster for first use.

The image is not a persistence layer. Files belong in the mounted workspace,
which Lingon snapshots to private durable storage before the VM is released.
