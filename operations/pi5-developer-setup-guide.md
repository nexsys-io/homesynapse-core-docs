# HomeSynapse Core — Raspberry Pi 5 Developer Setup Guide

**Document type:** Operations guide
**Status:** Active
**Last validated:** 2026-04-02
**Hardware validated on:** Raspberry Pi 5 (4 GB), KIOXIA KBG50ZNS256G NVMe 256 GB
**Author:** NexSys Technologies

---

## 0. Purpose

This guide walks a new developer through setting up a Raspberry Pi 5 as a headless HomeSynapse development and test target — from unboxing to running code remotely from a personal dev machine. The end state is a Pi that you plug into power, it connects to WiFi, Tailscale brings up the mesh VPN, and you SSH in from your laptop to build and run HomeSynapse code. No monitor, keyboard, or mouse needed after initial setup.

**Time estimate:** 30–45 minutes for Pi setup, 10 minutes for dev machine setup.

---

## 1. Prerequisites

Before starting this guide, you should have the following hardware assembled, powered on, and booted:

- **Raspberry Pi 5** (4 GB min / 8 GB recommended) with **active cooling** (mandatory — throttles without it)
- **NVMe SSD** via M.2 HAT+ or Pimoroni NVMe Base — no SD-only setups (SD cards lack the IOPS and endurance for SQLite WAL)
- **Official 27W USB-C PSU**
- **MicroSD card** (16 GB+) for OS boot only
- **Monitor + keyboard** connected for initial setup (not needed after this guide)

**OS:** Flash **Raspberry Pi OS** (Bookworm or later) via Raspberry Pi Imager with these settings: hostname `hs-dev-N` (your dev number), username `homesynapse`, WiFi pre-configured, SSH enabled with password auth, your timezone set. Boot the Pi, log in, and run:

```bash
sudo apt update && sudo apt upgrade -y
```

**Confirm before proceeding:** `uname -m` shows `aarch64`, `lsblk` shows `nvme0n1`, `whoami` shows `homesynapse`, and thermal reading (`cat /sys/class/thermal/thermal_zone0/temp`) is below 65000 (65°C at idle = cooling works).

---

## 2. NVMe Setup

The NVMe likely comes pre-formatted (NTFS from manufacturer or blank). We need to wipe it and create an ext4 partition with `noatime` for optimal SQLite WAL performance.

### 2.1 Confirm the Disk

```bash
sudo fdisk -l /dev/nvme0n1
```

Verify it shows your NVMe drive with the expected size. Confirm there is nothing on it you need.

### 2.2 Wipe, Partition, Format, Mount

```bash
# Wipe existing partition table
sudo wipefs -a /dev/nvme0n1

# Create GPT partition table with a single ext4 partition
sudo parted /dev/nvme0n1 --script mklabel gpt mkpart primary ext4 0% 100%

# Format as ext4 with a label
sudo mkfs.ext4 -L homesynapse-data /dev/nvme0n1p1

# Create mount point and mount with noatime
sudo mkdir -p /mnt/nvme
sudo mount -o noatime /dev/nvme0n1p1 /mnt/nvme

# Persist across reboots via fstab
echo "LABEL=homesynapse-data /mnt/nvme ext4 noatime 0 2" | sudo tee -a /etc/fstab
```

### 2.3 Verify

```bash
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,LABEL
df -h /mnt/nvme
```

Expected: `nvme0n1p1` shown as ext4, mounted at `/mnt/nvme`, with full disk capacity available.

---

## 3. Amazon Corretto 21 (Java)

HomeSynapse requires Amazon Corretto 21.0.10.7.1 exactly (LTD-01, Phase 2 Transition Guide §1).

```bash
# Import Amazon's GPG key and add the Corretto apt repository
wget -O - https://apt.corretto.aws/corretto.key | sudo gpg --dearmor -o /usr/share/keyrings/corretto-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/corretto-keyring.gpg] https://apt.corretto.aws stable main" | sudo tee /etc/apt/sources.list.d/corretto.list

sudo apt update
sudo apt install -y java-21-amazon-corretto-jdk
```

### 3.1 Verify

```bash
java -version
javac -version
```

Expected output includes: `Corretto-21.0.10.7.1 (build 21.0.10+7-LTS)`

### 3.2 Set JAVA_HOME
```bash
echo 'export JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto' >> ~/.profile
echo 'export PATH=$JAVA_HOME/bin:$PATH' >> ~/.profile
source ~/.profile
echo $JAVA_HOME
```

**Note:** These go in `~/.profile`, not `~/.bashrc`. Non-interactive SSH commands (`ssh pi "command"`) do not source `~/.bashrc`, which means tools like `jfr`, `jcmd`, and `jstack` won't be on PATH during remote execution. `~/.profile` is sourced for login shells and can be invoked remotely with `ssh pi "bash -lc 'command'"`.

---

## 4. FHS Directory Layout

HomeSynapse follows the Filesystem Hierarchy Standard (LTD-13, Doc 12 §8.3). SQLite databases and all write-heavy data live on the NVMe.

```bash
# Create the directory structure on NVMe
sudo mkdir -p /mnt/nvme/homesynapse/{data,backups,tmp}

# Create directories on the SD card (low-write paths)
sudo mkdir -p /var/log/homesynapse
sudo mkdir -p /etc/homesynapse
sudo mkdir -p /opt/homesynapse

# Symlink /var/lib/homesynapse to the NVMe data directory
sudo ln -s /mnt/nvme/homesynapse/data /var/lib/homesynapse

# Set ownership — writable dirs owned by homesynapse
sudo chown -R homesynapse:homesynapse /mnt/nvme/homesynapse
sudo chown -R homesynapse:homesynapse /var/log/homesynapse
sudo chown -R homesynapse:homesynapse /etc/homesynapse

# /opt/homesynapse is root-owned, read-only for homesynapse user
sudo chown -R root:homesynapse /opt/homesynapse
sudo chmod 750 /opt/homesynapse
```

### 4.1 Directory Map

| Path | Storage | Purpose | Owner |
|---|---|---|---|
| `/var/lib/homesynapse/` | NVMe (symlink) | SQLite databases, JFR recordings | homesynapse |
| `/mnt/nvme/homesynapse/backups/` | NVMe | Pre-upgrade snapshots | homesynapse |
| `/mnt/nvme/homesynapse/tmp/` | NVMe | Temp files (cleaned on startup) | homesynapse |
| `/var/log/homesynapse/` | SD card | Log files (low-write) | homesynapse |
| `/etc/homesynapse/` | SD card | YAML configuration | homesynapse |
| `/opt/homesynapse/` | SD card | Read-only jlink binary image | root:homesynapse |

---

## 5. Tailscale (Mesh VPN)

Tailscale provides a stable, routable IP for the Pi across any network. This is what makes headless SSH access work — the Pi gets the same Tailscale IP whether it's on your home WiFi, a hotel network, or tethered to your phone.

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate — this prints a URL you open on your phone or laptop
sudo tailscale up
```

Open the auth URL, log into your Tailscale account, and approve the device.

### 5.1 Verify

```bash
tailscale ip -4
tailscale status
```

Note your Tailscale IPv4 address (e.g., `100.x.y.z`). You'll need it for SSH config on your dev machine.

### 5.2 Verify Auto-Start

```bash
sudo systemctl is-enabled tailscaled
```

Should print `enabled`. This means Tailscale starts on every boot automatically.

---

## 6. Dev Utilities

```bash
sudo apt install -y git htop

git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### 6.1 SSH Server

SSH should already be running from the Imager configuration. Confirm:

```bash
sudo systemctl enable --now ssh
sudo systemctl status ssh | head -5
```

Prepare for key-based authentication:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
```

---

## 7. WiFi for Headless Use

Your home WiFi was configured during OS installation. To add additional known networks (e.g., a phone hotspot for travel):

```bash
# See current connection
nmcli device status

# Add another WiFi network
sudo nmcli device wifi connect "SSID_NAME" password "WIFI_PASSWORD"

# See all saved networks
nmcli connection show
```

**Phone USB tethering** is the universal fallback when no known WiFi is available. Plug your phone into the Pi via USB-C, enable USB tethering on the phone. Linux picks it up as a `usb0` network interface automatically — no configuration needed on the Pi.

---

## 8. Reboot Test

**This is critical.** Verify that NVMe, Tailscale, WiFi, and Java all survive a power cycle:

```bash
sudo reboot
```

Wait 30–60 seconds, log back in (monitor + keyboard for now), and run:

```bash
echo "=== NVMe ===" && df -h /mnt/nvme && ls /var/lib/homesynapse \
&& echo && echo "=== Tailscale ===" && tailscale ip -4 \
&& echo && echo "=== Java ===" && java -version 2>&1 \
&& echo && echo "=== JAVA_HOME ===" && echo $JAVA_HOME
```

All four must come back clean. If any fails, fix it before proceeding — the headless workflow depends on all of them surviving a power cycle.

---

## 9. Dev Machine Setup

Everything from here runs on **your personal dev machine** (laptop/desktop), not the Pi.

### 9.1 Enable MagicDNS

Go to <https://login.tailscale.com/admin/dns> and toggle MagicDNS **on**. This lets you use the Pi hostname (`hs-dev-N`) instead of its numeric Tailscale IP.

### 9.2 SSH Key Authentication

If you don't already have an SSH key:

```bash
ssh-keygen -t ed25519 -C "your.email@example.com"
```

Copy your public key to the Pi:

```bash
ssh-copy-id homesynapse@hs-dev-N
```

Enter your Pi password when prompted. This is the last time you'll need it.

### 9.3 SSH Config Alias

Add this to `~/.ssh/config` on your dev machine (create the file if it doesn't exist):

```
Host pi
    HostName hs-dev-N
    User homesynapse
```

Replace `hs-dev-N` with your Pi's actual hostname.

### 9.4 Test

```bash
ssh pi "hostname && whoami && java -version 2>&1 | head -1"
```

Expected output:

```
hs-dev-N
homesynapse
openjdk version "21.0.10" 2026-01-20 LTS
```

No password prompt. If this works, the headless dev loop is complete.

---

## 10. Deploying Code to the Pi

The build workflow is: **build on dev machine → deploy to Pi → run on Pi.** The Pi has 4 GB of RAM, and while Gradle works on it, your dev machine builds faster. The Pi's job is running the compiled code against its target hardware.

### 10.1 First Deploy

From your `homesynapse-core` directory on your dev machine:

**If you have rsync (Linux/macOS):**

```bash
rsync -avz --progress \
    --exclude='.gradle' \
    --exclude='**/build' \
    --exclude='.git' \
    --exclude='.idea' \
    ./ pi:~/homesynapse-core/
```

**If you don't have rsync (Windows/Git Bash):**

```bash
# Package, send, extract
tar czf /tmp/hs-core.tar.gz --exclude='.gradle' --exclude='build' --exclude='.git' --exclude='.idea' .
scp /tmp/hs-core.tar.gz pi:~/
ssh pi "mkdir -p ~/homesynapse-core && cd ~/homesynapse-core && tar xzf ~/hs-core.tar.gz && rm ~/hs-core.tar.gz && echo 'Extracted' && find . -name '*.java' | wc -l"
```

The Java file count confirms the full codebase arrived intact (expect ~920 files as of 2026-04).

### 10.2 Building on the Pi

```bash
ssh pi
cd ~/homesynapse-core

# First build downloads Gradle + all dependencies (2-3 minutes)
./gradlew assemble

# Subsequent builds are fast
./gradlew :spike:wal-validation:assemble
```

### 10.3 Running Tests on Target Hardware

Example — running the WAL validation spike (all databases land on NVMe):

```bash
# C1: Append Throughput
./gradlew :spike:wal-validation:runC1 --args="/var/lib/homesynapse/spike-c1.db"
```

### 10.4 Pulling JFR Recordings Back

From your dev machine:

```bash
scp pi:/var/lib/homesynapse/*.jfr ~/jfr-recordings/
```

Open in JDK Mission Control for analysis.

---

## 11. Daily Workflow Summary

```
1. Plug Pi into power (or it's already running)
2. From your dev machine:  ssh pi        ← you're in
3. Deploy code:            tar + scp     ← or rsync on Linux/macOS
4. Build:                  ./gradlew assemble
5. Run:                    java -cp ... <MainClass> /var/lib/homesynapse/test.db
6. Pull recordings:        scp pi:/var/lib/homesynapse/*.jfr ./
```

No monitor. No keyboard. No mouse. Just power and WiFi.

---

## 12. Final State Checklist

After completing this guide, verify each item:

| Item | Command | Expected |
|---|---|---|
| OS | `cat /etc/os-release \| head -1` | Debian (Bookworm or later) |
| Arch | `uname -m` | `aarch64` |
| RAM | `free -h \| grep Mem` | 4.0 Gi or 8.0 Gi |
| NVMe | `df -h /mnt/nvme` | ext4, 200+ GB available |
| NVMe fstab | `grep nvme /etc/fstab` | `LABEL=homesynapse-data /mnt/nvme ext4 noatime 0 2` |
| FHS symlink | `ls -la /var/lib/homesynapse` | → `/mnt/nvme/homesynapse/data` |
| Java | `java -version` | `Corretto-21.0.10.7.1` |
| JAVA_HOME | `echo $JAVA_HOME` | `/usr/lib/jvm/java-21-amazon-corretto` |
| Tailscale | `tailscale ip -4` | `100.x.y.z` |
| Tailscale auto-start | `systemctl is-enabled tailscaled` | `enabled` |
| SSH | `systemctl is-active ssh` | `active` |
| Git | `git --version` | Installed |
| Active cooling | `cat /sys/class/thermal/thermal_zone0/temp` | < 65000 at idle |
| Headless SSH | `ssh pi "hostname"` (from dev machine) | `hs-dev-N` |

---

## Appendix A: Troubleshooting

**Pi not reachable over Tailscale after reboot:**
- Confirm WiFi connected: `nmcli device status` (requires monitor+keyboard)
- Confirm Tailscale running: `sudo systemctl status tailscaled`
- Fallback: USB tether your phone, Tailscale will reconnect over cellular

**NVMe not mounted after reboot:**
- Check fstab: `cat /etc/fstab | grep nvme`
- Manual mount: `sudo mount -a`
- Check dmesg: `dmesg | grep nvme`

**Gradle build fails with out-of-memory:**
- Pi 4 GB is tight for full 19-module builds. Build on your dev machine and deploy the compiled output instead.
- For single-module builds (e.g., spike): `./gradlew :spike:wal-validation:assemble` uses much less memory.

**`java: command not found` after reboot:**
- Verify Corretto installed: `ls /usr/lib/jvm/java-21-amazon-corretto/bin/java`
- Re-source bashrc: `source ~/.bashrc`

## Appendix B: Reference Specifications

This setup implements requirements from:
- **LTD-01:** Java 21 LTS, Amazon Corretto, JVM configuration
- **LTD-02:** Raspberry Pi 5 recommended, Pi 4 validation floor, NVMe mandatory
- **LTD-03:** SQLite WAL mode, ext4 + noatime for persistence
- **LTD-13:** jlink distribution, systemd service, FHS layout, dedicated service user
- **Doc 12 §8.3:** PlatformPaths / LinuxSystemPaths directory mapping
- **AMD-26:** sqlite-jdbc virtual thread carrier pinning (informs test execution strategy)
