### Fixed

- `jig doctor` and `jig setup` no longer say "other users can read this file; make it private (chmod 600)" about a token file on a Windows drive under WSL (`/mnt/c/Users/<user>/AppData/...`): Linux shows every file there as readable by everyone and `chmod` changes nothing, because Windows decides who can read it. The drive is found from the kernel's mount table (a `drvfs` mount, or a `9p` mount with `aname=drvfs`), or from the `/mnt/<letter>/` path when that table is not there.
