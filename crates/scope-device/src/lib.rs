use anyhow::{bail, Context, Result};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{oneshot, Mutex as AsyncMutex},
};
mod adb;
mod diagnostics;
pub use diagnostics::{
    AdbDiagnostics, AdbMapping, AndroidDiagnostics, DeviceDiagnostics, DiagnosticCheck,
    FridaDiagnostics, MappingDiagnostics, RecoveryDiagnostics,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub serial: String,
    pub model: String,
    pub state: String,
    pub rooted: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub package: String,
    pub name: String,
    pub running: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub running: bool,
    pub serial: Option<String>,
    pub package: Option<String>,
    pub mode: Option<String>,
    pub message: String,
    pub logs: Vec<String>,
}
impl Default for DeviceStatus {
    fn default() -> Self {
        Self {
            running: false,
            serial: None,
            package: None,
            mode: None,
            message: "Connect an Android device with USB debugging enabled".into(),
            logs: vec![],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recovery {
    serial: String,
    package: String,
    mode: String,
    port: u16,
    previous_proxy: Option<String>,
    previous_reverse: Option<String>,
    forward_port: Option<u16>,
    server_pid: Option<u32>,
    ca_hash: Option<String>,
    root_shell: bool,
}

struct Active {
    recovery: Recovery,
    worker: Option<Child>,
}
struct Inner {
    runtime: PathBuf,
    adb: PathBuf,
    status: Mutex<DeviceStatus>,
    operation: AsyncMutex<()>,
    active: AsyncMutex<Option<Active>>,
    worker_generation: AtomicU64,
}
#[derive(Clone)]
pub struct DeviceManager {
    inner: Arc<Inner>,
}

impl DeviceManager {
    pub fn new(runtime_dir: PathBuf) -> Self {
        let status = if runtime_dir.join("device-recovery.json").is_file() {
            let saved = fs::read(runtime_dir.join("device-recovery.json"))
                .ok()
                .and_then(|data| serde_json::from_slice::<Recovery>(&data).ok());
            DeviceStatus {
                serial: saved.as_ref().map(|state| state.serial.clone()),
                package: saved.as_ref().map(|state| state.package.clone()),
                mode: saved.map(|state| state.mode),
                message: "A previous device session needs cleanup. Reconnect its device and press Stop before starting again.".into(),
                ..Default::default()
            }
        } else {
            DeviceStatus::default()
        };
        Self {
            inner: Arc::new(Inner {
                runtime: runtime_dir,
                adb: adb::discover_adb(),
                status: Mutex::new(status),
                operation: AsyncMutex::new(()),
                active: AsyncMutex::new(None),
                worker_generation: AtomicU64::new(0),
            }),
        }
    }

    pub fn status(&self) -> DeviceStatus {
        self.inner.status.lock().unwrap().clone()
    }

    fn log(&self, text: impl Into<String>) {
        let mut status = self.inner.status.lock().unwrap();
        status.logs.push(text.into());
        if status.logs.len() > 200 {
            status.logs.remove(0);
        }
    }

    async fn command(&self, serial: &str, args: &[&str]) -> Result<String> {
        adb::run(&self.inner.adb, Some(serial), args).await
    }

    async fn rooted(&self, serial: &str) -> (bool, bool) {
        if diagnostics::is_root(
            &adb::run_timeout(
                &self.inner.adb,
                Some(serial),
                &["shell", "id"],
                Duration::from_secs(4),
            )
            .await
            .unwrap_or_default(),
        ) {
            return (true, true);
        }
        let result = adb::run_timeout(
            &self.inner.adb,
            Some(serial),
            &["shell", "su", "-c", "'id'"],
            Duration::from_secs(4),
        )
        .await
        .unwrap_or_default();
        (diagnostics::is_root(&result), false)
    }

    async fn root_command(&self, state: &Recovery, command: &str) -> Result<String> {
        if state.root_shell {
            self.command(&state.serial, &["shell", command]).await
        } else {
            self.command(&state.serial, &["shell", "su", "-c", &adb::quote(command)])
                .await
        }
    }

    pub async fn list_devices(&self) -> Result<Vec<Device>> {
        let text = adb::run(&self.inner.adb, None, &["devices", "-l"]).await?;
        let mut devices = adb::parse_devices(&text);
        for device in &mut devices {
            if device.state == "device" {
                device.rooted = self.rooted(&device.serial).await.0;
            }
        }
        Ok(devices)
    }

    pub async fn list_apps(&self, serial: &str) -> Result<Vec<App>> {
        adb::validate_serial(serial)?;
        let packages = self
            .command(serial, &["shell", "pm", "list", "packages"])
            .await?;
        let processes = self
            .command(serial, &["shell", "ps", "-A", "-o", "NAME"])
            .await
            .unwrap_or_default();
        let mut apps = adb::parse_apps(&packages, &processes);
        // Frida can provide real display labels without installing a helper APK.
        // Enumeration falls back to exact package IDs if a server is unavailable.
        self.materialize()?;
        let mut child = worker_command(&self.inner.runtime);
        child
            .args(["--serial", serial, "--list-apps"])
            .stdin(Stdio::null())
            .kill_on_drop(true);
        let address = self
            .inner
            .active
            .lock()
            .await
            .as_ref()
            .and_then(|active| {
                (active.recovery.serial == serial)
                    .then_some(active.recovery.forward_port)
                    .flatten()
            })
            .map(|port| format!("127.0.0.1:{port}"));
        if let Some(address) = address {
            child.args(["--address", &address]);
        }
        if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_secs(7), child.output()).await {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                        if let Some(labels) = value.get("apps").and_then(|v| v.as_array()) {
                            let labels: HashMap<_, _> = labels
                                .iter()
                                .filter_map(|app| Some((app.get("package")?.as_str()?, app)))
                                .collect();
                            for app in &mut apps {
                                if let Some(label) = labels.get(app.package.as_str()) {
                                    app.name = label
                                        .get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(&app.package)
                                        .into();
                                    app.running = label
                                        .get("running")
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(app.running);
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(apps)
    }

    pub async fn start(
        &self,
        serial: String,
        package: String,
        mode: String,
        proxy_port: u16,
        ca_cert: PathBuf,
        profile: Vec<String>,
    ) -> Result<DeviceStatus> {
        let _operation = self.inner.operation.lock().await;
        adb::validate_serial(&serial)?;
        adb::validate_package(&package)?;
        if !["proxy", "frida"].contains(&mode.as_str()) {
            bail!("Mode must be proxy or frida");
        }
        for value in &profile {
            if !["proxy", "certificate", "unpinning", "root", "system-ca"].contains(&value.as_str())
            {
                bail!("Unknown instrumentation profile: {value}");
            }
        }
        if proxy_port == 0 {
            bail!("Proxy port must be greater than zero");
        }
        if self.inner.active.lock().await.is_some() || self.recovery_path().exists() {
            bail!("Stop the existing device session first. A saved recovery file must be cleaned up before another session starts");
        }
        tokio::time::timeout(
            Duration::from_secs(3),
            tokio::net::TcpStream::connect(("127.0.0.1", proxy_port)),
        )
        .await
        .context("Scope proxy is not accepting connections")?
        .context("Start the Scope proxy before device interception")?;
        if self.command(&serial, &["get-state"]).await.context("Selected device is disconnected, offline or unauthorized. Run connection diagnostics and accept its USB debugging prompt")? != "device" {
            bail!("Selected device is not ready. Run connection diagnostics before starting interception");
        }
        if !self
            .command(&serial, &["shell", "pm", "path", &package])
            .await?
            .starts_with("package:")
        {
            bail!("The selected package is not installed");
        }
        let (rooted, root_shell) = self.rooted(&serial).await;
        if mode == "frida" && !rooted {
            bail!("Frida mode requires confirmed root access. Grant Shell superuser access on your rooted lab device, or choose system proxy mode for HTTP. Run connection diagnostics for the root result; no device settings were changed");
        }
        let frida_preflight = if mode == "frida" {
            let abi = self
                .command(&serial, &["shell", "getprop", "ro.product.cpu.abi"])
                .await?;
            if frida_arch(&abi).is_none() {
                bail!("Unsupported or unknown Android ABI {abi:?}. Frida mode needs arm64-v8a, armeabi-v7a, x86 or x86_64; system proxy mode does not require Frida. No device settings were changed");
            }
            let version = self.worker_version().await.map_err(|error| {
                let setup = self.setup_command(&abi);
                anyhow::anyhow!("Optional Frida runtime is unavailable: {error:#}\nRun this once in your terminal, then try Start again:\n{setup}\nThis creates Scope's private runtime; no Android settings have changed.")
            })?;
            let server = diagnostics::server_selection(&self.inner.runtime, Some(&abi));
            if let Some(path) = server.path.filter(|_| server.local) {
                diagnostics::inspect_server(&path, Some(&abi))
                    .context("The selected Frida server cannot run on this Android ABI; no device settings were changed")?;
            }
            if let Some(path) = env::var_os("SCOPE_FRIDA_SERVER") {
                if !diagnostics::valid_device_path(std::path::Path::new(&path)) {
                    bail!("SCOPE_FRIDA_SERVER must be an absolute device path without shell characters; no device settings were changed");
                }
            }
            Some((abi, version))
        } else {
            None
        };
        let previous_reverse = self
            .command(&serial, &["reverse", "--list"])
            .await?
            .lines()
            .find_map(|line| {
                let fields: Vec<_> = line.split_whitespace().collect();
                (fields.len() >= 3 && fields[1] == format!("tcp:{proxy_port}"))
                    .then(|| fields[2].to_string())
            });
        let previous_proxy = if mode == "proxy" {
            Some(
                self.command(
                    &serial,
                    &["shell", "settings", "get", "global", "http_proxy"],
                )
                .await?,
            )
        } else {
            None
        };
        let mut state = Recovery {
            serial: serial.clone(),
            package: package.clone(),
            mode: mode.clone(),
            port: proxy_port,
            previous_proxy,
            previous_reverse,
            forward_port: None,
            server_pid: None,
            ca_hash: None,
            root_shell,
        };
        *self.inner.status.lock().unwrap() = DeviceStatus {
            running: false,
            serial: Some(serial),
            package: Some(package),
            mode: Some(mode.clone()),
            message: "Preparing device interception".into(),
            logs: vec![],
        };
        self.materialize()?;
        let generation = self.inner.worker_generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.save_recovery(&state)?;
        let setup = async {
            self.command(&state.serial, &["reverse", &format!("tcp:{proxy_port}"), &format!("tcp:{proxy_port}")]).await?;
            self.log(format!("ADB reverse: device 127.0.0.1:{proxy_port} → Scope localhost:{proxy_port}"));
            let worker = if mode == "proxy" {
                self.log("Proxy mode is DEVICE-WIDE. The selected package is launched, but Android may route other applications through this proxy.");
                if rooted {
                    let hash = certificate_hash(&ca_cert)?;
                    let existing = self.root_command(&state, &format!("cat /apex/com.android.conscrypt/cacerts/{hash}.0 2>/dev/null || cat /system/etc/security/cacerts/{hash}.0 2>/dev/null || true")).await?;
                    if !existing.trim().is_empty() && existing.trim() != fs::read_to_string(&ca_cert)?.trim() {
                        bail!("An existing Android CA uses the same subject hash. Scope will not overwrite it");
                    }
                    if existing.trim().is_empty() {
                    // Record the exact certificate before attempting injection so partial setup is recoverable.
                    state.ca_hash = Some(hash);
                    self.save_recovery(&state)?;
                    self.install_ca(&state, &ca_cert).await?;
                    } else {
                        self.log("Scope CA was already present; it will be preserved on Stop");
                    }
                } else {
                    self.log("No root: HTTP capture is available. HTTPS requires the app to trust Scope's CA manually; certificate pinning remains active.");
                }
                self.command(&state.serial, &["shell", "settings", "put", "global", "http_proxy", &format!("127.0.0.1:{proxy_port}")]).await?;
                self.launch(&state).await?;
                if state.ca_hash.is_some() { self.verify_ca(&state, &ca_cert).await?; }
                (None, None)
            } else {
                self.log("Frida mode instruments the selected application process only; Java HTTP stacks are supported. Native TLS, child processes and QUIC are not guaranteed.");
                let (abi, version) = frida_preflight.as_ref().context("Missing Frida preflight")?;
                let address = self.prepare_frida_server(&mut state, abi, version).await?;
                self.save_recovery(&state)?;
                let (worker, live) = self.spawn_worker(&state, &ca_cert, &profile, address, generation).await?;
                (Some(worker), Some(live))
            };
            Ok::<_, anyhow::Error>(worker)
        }.await;
        match setup {
            Ok((worker, live)) => {
                *self.inner.active.lock().await = Some(Active {
                    recovery: state,
                    worker,
                });
                let mut status = self.inner.status.lock().unwrap();
                status.running = live.as_ref().is_none_or(|live| live.load(Ordering::SeqCst));
                if !status.running {
                    status.message = "Frida worker exited just after startup. Press Stop to restore owned ADB mappings, then inspect connection diagnostics.".into();
                    bail!("Frida worker exited just after hook readiness; press Stop to restore the recorded device state");
                }
                status.message = if mode == "proxy" {
                    "Capturing device-wide traffic through Android's global proxy".into()
                } else {
                    "Selected app instrumented with experimental Frida Java hooks".into()
                };
                Ok(status.clone())
            }
            Err(error) => {
                self.log(format!("Setup failed: {error:#}"));
                let cleanup = self.cleanup(&state).await;
                let mut status = self.inner.status.lock().unwrap();
                status.running = false;
                status.message = match cleanup {
                    Ok(_) => "Setup failed; device settings restored".into(),
                    Err(ref e) => format!(
                        "Setup failed; reconnect device and press Stop to finish cleanup: {e:#}"
                    ),
                };
                Err(error)
            }
        }
    }

    async fn launch(&self, state: &Recovery) -> Result<()> {
        let component = self
            .command(
                &state.serial,
                &[
                    "shell",
                    "cmd",
                    "package",
                    "resolve-activity",
                    "--brief",
                    "-a",
                    "android.intent.action.MAIN",
                    "-c",
                    "android.intent.category.LAUNCHER",
                    &state.package,
                ],
            )
            .await?;
        let component = component.lines().last().unwrap_or("").trim();
        if !component.starts_with(&format!("{}/", state.package))
            || !component
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_.$/".contains(&c))
        {
            bail!("Selected app has no matching launcher activity");
        }
        self.command(
            &state.serial,
            &["shell", "am", "force-stop", &state.package],
        )
        .await?;
        let result = self
            .command(
                &state.serial,
                &["shell", "am", "start", "-W", "-n", component],
            )
            .await?;
        if result.contains("Error:") {
            bail!("Android could not launch application: {result}");
        }
        self.log(format!("Launched {}", state.package));
        Ok(())
    }

    async fn install_ca(&self, state: &Recovery, cert: &std::path::Path) -> Result<()> {
        let hash = state.ca_hash.as_ref().context("Missing CA hash")?;
        let remote_cert = format!("/data/local/tmp/scope-{hash}.0");
        let remote_script = "/data/local/tmp/scope-install-ca.sh";
        let script = include_str!("../../../resources/device/install-system-ca.template.sh")
            .replace("htk-ca-copy", "scope-ca-copy")
            .replace("${certificatePath}", &remote_cert)
            .replace("${injectionScriptPath}", remote_script);
        // The template moves the input basename into cacerts: it must be <subject_hash>.0.
        let script = script.replace(
            &format!("mv {remote_cert} /system/etc/security/cacerts/"),
            &format!("cp {remote_cert} /system/etc/security/cacerts/{hash}.0"),
        );
        let path = self.inner.runtime.join("install-system-ca.sh");
        fs::write(&path, script)?;
        self.command(
            &state.serial,
            &["push", &cert.to_string_lossy(), &remote_cert],
        )
        .await?;
        self.command(
            &state.serial,
            &["push", &path.to_string_lossy(), remote_script],
        )
        .await?;
        let result = self
            .root_command(state, &format!("sh {remote_script}"))
            .await?;
        if !result.contains("System cert successfully injected") {
            bail!("System CA injection was not confirmed");
        }
        self.log(format!(
            "Temporary Scope CA {hash}.0 injected into Android trust stores; removed on Stop"
        ));
        Ok(())
    }

    async fn verify_ca(&self, state: &Recovery, cert: &PathBuf) -> Result<()> {
        let pid = self
            .command(&state.serial, &["shell", "pidof", &state.package])
            .await?;
        let pid = pid
            .split_whitespace()
            .next()
            .context("Launched app PID was not found")?;
        if !pid.bytes().all(|c| c.is_ascii_digit()) {
            bail!("Invalid application PID");
        }
        let hash = state.ca_hash.as_ref().context("Missing CA hash")?;
        let command = format!("nsenter --mount=/proc/{pid}/ns/mnt -- cat /apex/com.android.conscrypt/cacerts/{hash}.0 || nsenter --mount=/proc/{pid}/ns/mnt -- cat /system/etc/security/cacerts/{hash}.0");
        let installed = self.root_command(state, &command).await?;
        if installed.trim() != fs::read_to_string(cert)?.trim() {
            bail!("Scope CA was not visible in the selected app's mount namespace");
        }
        self.log("Scope CA verified in the selected application's mount namespace");
        Ok(())
    }

    async fn prepare_frida_server(
        &self,
        state: &mut Recovery,
        abi: &str,
        expected_version: &str,
    ) -> Result<Option<String>> {
        let selected = diagnostics::server_selection(&self.inner.runtime, Some(abi));
        if selected.source == "existingUsb" {
            self.log("Connecting to an existing Frida USB server. Set SCOPE_FRIDA_SERVER_LOCAL to provision a matching server, or SCOPE_FRIDA_SERVER to an existing device binary.");
            return Ok(None);
        }
        let remote = env::var("SCOPE_FRIDA_SERVER").ok().unwrap_or_else(|| {
            if selected.local {
                "/data/local/tmp/scope-frida-server".into()
            } else {
                selected
                    .path
                    .as_ref()
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_default()
            }
        });
        if !diagnostics::valid_device_path(std::path::Path::new(&remote)) {
            bail!("SCOPE_FRIDA_SERVER must be an absolute device path without shell characters");
        }
        if let Some(local) = selected.path.filter(|_| selected.local) {
            diagnostics::inspect_server(&local, Some(abi))?;
            self.command(&state.serial, &["push", &local.to_string_lossy(), &remote])
                .await?;
            self.command(&state.serial, &["shell", "chmod", "755", &remote])
                .await?;
        }
        let version = self
            .root_command(state, &format!("{remote} --version"))
            .await?;
        if version.trim() != expected_version {
            bail!(
                "Frida version mismatch: device {} versus worker {}. Install exact matching versions or remove conflicting SCOPE_FRIDA_* overrides",
                version.trim(),
                expected_version
            );
        }
        let port = 24073;
        let sockets = self
            .root_command(state, "cat /proc/net/tcp")
            .await
            .context("Cannot inspect Android TCP sockets before starting the owned Frida server")?;
        let sockets6 = self
            .root_command(state, "cat /proc/net/tcp6 2>/dev/null || true")
            .await?;
        if tcp_port_listening(&sockets, port) || tcp_port_listening(&sockets6, port) {
            bail!("Android TCP port {port} already has a listener. Scope will not replace or stop an unrelated server. Stop your own listener or use an existing default-port USB Frida server, then retry");
        }
        // Only this spawned PID is owned and stopped by Scope. Existing servers are left alone.
        let pid = self.root_command(state, &format!("{remote} -l 127.0.0.1:{port} >/data/local/tmp/scope-frida-server.log 2>&1 & echo $!")).await?;
        let pid: u32 = pid
            .lines()
            .last()
            .context("Missing Frida server PID")?
            .parse()
            .context("Invalid Frida server PID")?;
        if pid <= 1 {
            bail!("Frida server returned an unsafe process identifier");
        }
        state.server_pid = Some(pid);
        self.save_recovery(state)?;
        tokio::time::sleep(Duration::from_millis(500)).await;
        if !self
            .root_command(state, &format!("kill -0 {pid} && cat /proc/{pid}/cmdline"))
            .await
            .is_ok_and(|command| command.contains("127.0.0.1:24073"))
        {
            let log = self
                .root_command(
                    state,
                    "tail -c 2000 /data/local/tmp/scope-frida-server.log 2>/dev/null || true",
                )
                .await
                .unwrap_or_default();
            bail!("The owned Frida server exited before it became available. Check the selected ABI, Android compatibility and port 24073. Device log: {log}");
        }
        let forward = self
            .command(&state.serial, &["forward", "tcp:0", &format!("tcp:{port}")])
            .await?;
        let forward: u16 = forward.parse().context("Invalid forwarded Frida port")?;
        if forward == 0 {
            bail!("ADB returned an invalid zero Frida forwarding port");
        }
        state.forward_port = Some(forward);
        self.save_recovery(state)?;
        self.log(format!(
            "Started matching Frida server {version} with a dedicated local ADB forward"
        ));
        Ok(Some(format!("127.0.0.1:{forward}")))
    }

    async fn spawn_worker(
        &self,
        state: &Recovery,
        cert: &PathBuf,
        profile: &[String],
        address: Option<String>,
        generation: u64,
    ) -> Result<(Child, Arc<AtomicBool>)> {
        let mut command = worker_command(&self.inner.runtime);
        command
            .args([
                "--serial",
                &state.serial,
                "--package",
                &state.package,
                "--ca",
            ])
            .arg(cert)
            .arg("--scripts")
            .arg(self.inner.runtime.join("frida"))
            .args(["--port", &state.port.to_string()]);
        if let Some(address) = address {
            command.args(["--address", &address]);
        }
        for profile in profile.iter().filter(|v| v.as_str() != "system-ca") {
            command.args(["--profile", profile]);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command.spawn().context("Cannot start Frida worker; set SCOPE_PYTHON to a Python executable with frida installed")?;
        let stdout = child.stdout.take().context("Missing Frida worker stdout")?;
        let stderr = child.stderr.take().context("Missing Frida worker stderr")?;
        let (sender, receiver) = oneshot::channel();
        let live = Arc::new(AtomicBool::new(true));
        let worker_live = live.clone();
        tokio::spawn(monitor_worker_output(
            self.clone(),
            stdout,
            generation,
            worker_live,
            sender,
        ));
        let manager = self.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                manager.log(line);
            }
        });
        match tokio::time::timeout(Duration::from_secs(40), receiver).await {
            Ok(Ok(Ok(()))) => Ok((child, live)),
            result => {
                drop(child.stdin.take());
                let _ = child.kill().await;
                match result {
                    Ok(Ok(Err(message))) => bail!(message),
                    _ => bail!("Frida worker did not confirm hook readiness within 40 seconds"),
                }
            }
        }
    }

    pub async fn stop(&self) -> Result<DeviceStatus> {
        let _operation = self.inner.operation.lock().await;
        // Ignore late stdout/EOF notifications from a worker being intentionally stopped.
        self.inner.worker_generation.fetch_add(1, Ordering::SeqCst);
        let active = self.inner.active.lock().await.take();
        let state = if let Some(mut active) = active {
            if let Some(mut child) = active.worker.take() {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(b"stop\n").await;
                }
                if tokio::time::timeout(Duration::from_secs(5), child.wait())
                    .await
                    .is_err()
                {
                    let _ = child.kill().await;
                }
            }
            Some(active.recovery)
        } else if self.recovery_path().is_file() {
            Some(serde_json::from_slice::<Recovery>(&fs::read(
                self.recovery_path(),
            )?)?)
        } else {
            None
        };
        if let Some(state) = state {
            if let Err(error) = self.cleanup(&state).await {
                let mut status = self.inner.status.lock().unwrap();
                status.running = false;
                status.message = format!(
                    "Cleanup incomplete. Reconnect {} and press Stop again: {error:#}",
                    state.serial
                );
                return Err(error);
            }
        }
        let mut status = self.inner.status.lock().unwrap();
        status.running = false;
        status.message = "Device settings restored; saved captures remain available".into();
        Ok(status.clone())
    }

    async fn cleanup(&self, state: &Recovery) -> Result<()> {
        // Validate every persisted field before the first cleanup command.
        diagnostics::validate_recovery(state)?;
        let mut errors = vec![];
        if let Some(old) = &state.previous_proxy {
            let current = self
                .command(
                    &state.serial,
                    &["shell", "settings", "get", "global", "http_proxy"],
                )
                .await;
            let restore = match current {
                Ok(current) => {
                    let decision = restoration_decision(
                        normalize_proxy(&current),
                        &format!("127.0.0.1:{}", state.port),
                        normalize_proxy(old),
                    );
                    match decision {
                        Restoration::AlreadyRestored => {
                            self.log("Android proxy was already restored")
                        }
                        Restoration::PreserveExternal => self.log(
                            "Android proxy changed outside Scope; preserving the current setting",
                        ),
                        Restoration::Restore => {}
                    }
                    decision == Restoration::Restore
                }
                Err(error) => {
                    errors.push(format!("Cannot inspect current Android proxy: {error:#}"));
                    false
                }
            };
            if restore {
                let args = if old.is_empty() || old == "null" {
                    vec!["shell", "settings", "delete", "global", "http_proxy"]
                } else {
                    vec!["shell", "settings", "put", "global", "http_proxy", old]
                };
                // Quote existing user settings, which are not controlled by Scope.
                let args: Vec<String> = args
                    .iter()
                    .enumerate()
                    .map(|(i, v)| if i == 5 { adb::quote(v) } else { v.to_string() })
                    .collect();
                let args: Vec<_> = args.iter().map(String::as_str).collect();
                if let Err(error) = self.command(&state.serial, &args).await {
                    errors.push(error.to_string());
                } else {
                    self.log("Previous Android proxy restored");
                }
            }
        }
        if let Some(hash) = &state.ca_hash {
            let script = format!("rm -f /system/etc/security/cacerts/{hash}.0 /apex/com.android.conscrypt/cacerts/{hash}.0 /data/local/tmp/scope-{hash}.0 /data/local/tmp/scope-install-ca.sh; for pid in $(pidof zygote zygote64 {}); do nsenter --mount=/proc/$pid/ns/mnt -- rm -f /apex/com.android.conscrypt/cacerts/{hash}.0 /system/etc/security/cacerts/{hash}.0 || exit 1; done", state.package);
            if let Err(error) = self.root_command(state, &script).await {
                errors.push(error.to_string());
            } else {
                self.log("Scope CA removed from shared trust stores and selected app; temporary mount overlays disappear after reboot");
            }
        }
        if let Some(port) = state.forward_port {
            match self.command(&state.serial, &["forward", "--list"]).await {
                Ok(mappings) => {
                    let local = format!("tcp:{port}");
                    let mappings =
                        diagnostics::parse_mappings(&mappings, "forward", &state.serial, None);
                    let current = mappings
                        .iter()
                        .find(|mapping| mapping.local == local)
                        .map(|mapping| mapping.remote.as_str());
                    if restoration_decision(current, "tcp:24073", None) == Restoration::Restore {
                        if let Err(error) = self
                            .command(
                                &state.serial,
                                &["forward", "--remove", &format!("tcp:{port}")],
                            )
                            .await
                        {
                            errors.push(error.to_string());
                        }
                    } else {
                        self.log("Owned Frida forward is absent or changed outside Scope; preserving other mappings");
                    }
                }
                Err(error) => {
                    errors.push(format!("Cannot inspect current ADB forwarding: {error:#}"))
                }
            }
        }
        if let Some(pid) = state.server_pid {
            let command = format!("if [ -r /proc/{pid}/cmdline ] && tr '\\0' ' ' </proc/{pid}/cmdline | grep -q '127.0.0.1:24073'; then kill {pid}; fi");
            if let Err(error) = self.root_command(state, &command).await {
                errors.push(error.to_string());
            }
        }
        let reverse = format!("tcp:{}", state.port);
        match self.command(&state.serial, &["reverse", "--list"]).await {
            Ok(mappings) => {
                let mappings =
                    diagnostics::parse_mappings(&mappings, "reverse", &state.serial, None);
                let current = mappings
                    .iter()
                    .find(|mapping| mapping.local == reverse)
                    .map(|mapping| mapping.remote.as_str());
                match restoration_decision(current, &reverse, state.previous_reverse.as_deref()) {
                    Restoration::Restore => {
                        let result = if let Some(old) = &state.previous_reverse {
                            self.command(&state.serial, &["reverse", &reverse, old])
                                .await
                        } else {
                            self.command(&state.serial, &["reverse", "--remove", &reverse])
                                .await
                        };
                        if let Err(error) = result {
                            errors.push(error.to_string());
                        }
                    }
                    Restoration::AlreadyRestored => {
                        self.log("ADB reverse mapping was already restored")
                    }
                    Restoration::PreserveExternal => self.log(
                        "ADB reverse mapping changed outside Scope; preserving the current mapping",
                    ),
                }
            }
            Err(error) => errors.push(format!(
                "Cannot inspect current ADB reverse mappings: {error:#}"
            )),
        }
        if !errors.is_empty() {
            bail!("{}", errors.join("; "));
        }
        if self.recovery_path().exists() {
            fs::remove_file(self.recovery_path())?;
        }
        Ok(())
    }

    fn recovery_path(&self) -> PathBuf {
        self.inner.runtime.join("device-recovery.json")
    }

    async fn worker_version(&self) -> Result<String> {
        diagnostics::runtime_version(&self.inner.runtime).await
    }

    fn worker_ended(&self, generation: u64, message: &str) {
        let mut status = self.inner.status.lock().unwrap();
        if self.inner.worker_generation.load(Ordering::SeqCst) == generation {
            status.running = false;
            status.message = message.into();
        }
    }

    fn setup_command(&self, abi: &str) -> String {
        let installer = resource_file("device/install-runtime.py")
            .unwrap_or_else(|| PathBuf::from("resources/device/install-runtime.py"));
        let interpreter = if cfg!(windows) { "py -3" } else { "python3" };
        format!(
            "{interpreter} {} --runtime-dir {} --abi {}",
            terminal_quote(&installer.to_string_lossy()),
            terminal_quote(&self.inner.runtime.to_string_lossy()),
            terminal_quote(abi)
        )
    }
    fn save_recovery(&self, state: &Recovery) -> Result<()> {
        fs::create_dir_all(&self.inner.runtime)?;
        let temporary = self.inner.runtime.join("device-recovery.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(state)?)?;
        fs::rename(temporary, self.recovery_path())?;
        Ok(())
    }

    fn materialize(&self) -> Result<()> {
        fs::create_dir_all(self.inner.runtime.join("frida/android"))?;
        for (path, content) in ASSETS {
            fs::write(self.inner.runtime.join(path), content)?;
        }
        Ok(())
    }
}

async fn monitor_worker_output<R: tokio::io::AsyncRead + Unpin>(
    manager: DeviceManager,
    stdout: R,
    generation: u64,
    live: Arc<AtomicBool>,
    sender: oneshot::Sender<std::result::Result<(), String>>,
) {
    let mut sender = Some(sender);
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            match value.get("kind").and_then(|v| v.as_str()).unwrap_or("log") {
                "ready" => {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Ok(()));
                    }
                }
                "error" => {
                    let message = value
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Frida worker failed")
                        .to_string();
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Err(message.clone()));
                    }
                    manager.log(message);
                    live.store(false, Ordering::SeqCst);
                    manager.worker_ended(generation, "Frida worker reported an error; press Stop to restore the recorded device state");
                }
                "stopped" | "detached" => {
                    if let Some(sender) = sender.take() {
                        let detail = value
                            .get("message")
                            .and_then(|value| value.as_str())
                            .unwrap_or("device session ended");
                        let _ = sender.send(Err(format!("Frida detached before hook readiness: {detail}. Check Android compatibility and the selected app's process")));
                    }
                    live.store(false, Ordering::SeqCst);
                    manager.worker_ended(
                        generation,
                        "Frida worker detached; press Stop to restore the recorded device state",
                    );
                }
                _ => manager.log(
                    value
                        .get("message")
                        .map(|v| v.as_str().unwrap_or("Frida diagnostic"))
                        .unwrap_or("Frida diagnostic"),
                ),
            }
        }
    }
    if let Some(sender) = sender.take() {
        let _ = sender.send(Err("Frida worker exited before hooks became ready".into()));
    }
    live.store(false, Ordering::SeqCst);
    manager.worker_ended(generation, "Frida worker exited; press Stop to restore the recorded device state and inspect the local worker log");
}

#[derive(Debug, PartialEq, Eq)]
enum Restoration {
    Restore,
    AlreadyRestored,
    PreserveExternal,
}
fn restoration_decision(current: Option<&str>, owned: &str, previous: Option<&str>) -> Restoration {
    if current == Some(owned) {
        Restoration::Restore
    } else if current == previous {
        Restoration::AlreadyRestored
    } else {
        Restoration::PreserveExternal
    }
}
fn normalize_proxy(proxy: &str) -> Option<&str> {
    let proxy = proxy.trim();
    (!proxy.is_empty() && proxy != "null").then_some(proxy)
}

fn tcp_port_listening(sockets: &str, port: u16) -> bool {
    sockets.lines().any(|line| {
        let fields: Vec<_> = line.split_whitespace().collect();
        fields.len() >= 4
            && fields[3] == "0A"
            && fields[1]
                .rsplit(':')
                .next()
                .and_then(|hex| u16::from_str_radix(hex, 16).ok())
                == Some(port)
    })
}

fn python() -> std::ffi::OsString {
    env::var_os("SCOPE_PYTHON").unwrap_or_else(|| {
        if cfg!(windows) {
            "python".into()
        } else {
            "python3".into()
        }
    })
}

fn resource_file(relative: &str) -> Option<PathBuf> {
    let root = env::var_os("SCOPE_RESOURCES")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../resources"));
    let path = root.join(relative);
    path.is_file().then_some(path)
}

fn worker_command(runtime: &std::path::Path) -> Command {
    let binary = env::var_os("SCOPE_FRIDA_WORKER")
        .map(PathBuf::from)
        .or_else(|| {
            if env::var_os("SCOPE_PYTHON").is_some() {
                None
            } else {
                resource_file(if cfg!(windows) {
                    "bin/scope-frida-worker.exe"
                } else {
                    "bin/scope-frida-worker"
                })
            }
        });
    let command = if let Some(binary) = binary {
        Command::new(binary)
    } else {
        let managed = runtime.join("managed-frida/venv").join(if cfg!(windows) {
            "Scripts/python.exe"
        } else {
            "bin/python"
        });
        let interpreter = env::var_os("SCOPE_PYTHON").unwrap_or_else(|| {
            if managed.is_file() {
                managed.into_os_string()
            } else {
                python()
            }
        });
        let mut command = Command::new(interpreter);
        command.arg(runtime.join("frida_worker.py"));
        command
    };
    #[cfg(windows)]
    let mut command = command;
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
}

fn terminal_quote(value: &str) -> String {
    if cfg!(windows) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        adb::quote(value)
    }
}

fn frida_arch(abi: &str) -> Option<&'static str> {
    match abi.trim() {
        "arm64-v8a" => Some("arm64"),
        "armeabi-v7a" => Some("arm"),
        "x86" => Some("x86"),
        "x86_64" => Some("x86_64"),
        _ => None,
    }
}

fn certificate_hash(path: &PathBuf) -> Result<String> {
    let pem = pem::parse(fs::read(path)?).context("Cannot parse Scope public CA")?;
    let (_, cert) = x509_parser::parse_x509_certificate(pem.contents())
        .map_err(|e| anyhow::anyhow!("Cannot parse Scope CA: {e}"))?;
    let hash = Md5::digest(cert.subject().as_raw());
    Ok(format!(
        "{:08x}",
        u32::from_le_bytes(hash[..4].try_into().unwrap())
    ))
}

const ASSETS: &[(&str, &str)] = &[
    (
        "frida_worker.py",
        include_str!("../../../resources/device/frida_worker.py"),
    ),
    (
        "frida/config-template.js",
        include_str!("../../../resources/frida/config-template.js"),
    ),
    (
        "frida/frida-java-bridge.js",
        include_str!("../../../resources/frida/frida-java-bridge.js"),
    ),
    (
        "frida/android/android-proxy-override.js",
        include_str!("../../../resources/frida/android/android-proxy-override.js"),
    ),
    (
        "frida/android/android-system-certificate-injection.js",
        include_str!("../../../resources/frida/android/android-system-certificate-injection.js"),
    ),
    (
        "frida/android/android-certificate-unpinning.js",
        include_str!("../../../resources/frida/android/android-certificate-unpinning.js"),
    ),
    (
        "frida/android/android-certificate-unpinning-fallback.js",
        include_str!("../../../resources/frida/android/android-certificate-unpinning-fallback.js"),
    ),
    (
        "frida/android/android-disable-root-detection.js",
        include_str!("../../../resources/frida/android/android-disable-root-detection.js"),
    ),
];

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[tokio::test]
    async fn cleanup_checks_live_mapping_ownership_before_mutations() {
        use std::os::unix::fs::PermissionsExt;
        for external_change in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let log = directory.path().join("commands.log");
            let fake_adb = directory.path().join("fake-adb");
            let (proxy, reverse, forward) = if external_change {
                ("127.0.0.1:29999", "tcp:19999", "tcp:27042")
            } else {
                ("127.0.0.1:17890", "tcp:17890", "tcp:24073")
            };
            fs::write(&fake_adb, format!(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {}\ncase \"$*\" in\n'-s fixture-01 shell settings get global http_proxy') printf '%s\\n' '{proxy}';;\n'-s fixture-01 forward --list') printf '%s\\n' 'fixture-01 tcp:42123 {forward}';;\n'-s fixture-01 reverse --list') printf '%s\\n' 'UsbFfs tcp:17890 {reverse}';;\n*) {};;\nesac\n",
                adb::quote(&log.to_string_lossy()),
                if external_change { "echo 'unexpected mutation' >&2; exit 9" } else { "exit 0" }
            )).unwrap();
            fs::set_permissions(&fake_adb, fs::Permissions::from_mode(0o755)).unwrap();
            let mut manager = DeviceManager::new(directory.path().to_owned());
            Arc::get_mut(&mut manager.inner).unwrap().adb = fake_adb;
            manager
                .save_recovery(&Recovery {
                    serial: "fixture-01".into(),
                    package: "com.scope.demo".into(),
                    mode: "proxy".into(),
                    port: 17890,
                    previous_proxy: Some(":0".into()),
                    previous_reverse: Some("tcp:18888".into()),
                    forward_port: Some(42123),
                    server_pid: None,
                    ca_hash: None,
                    root_shell: false,
                })
                .unwrap();
            manager.stop().await.unwrap();
            let commands = fs::read_to_string(log).unwrap();
            assert_eq!(commands.contains("settings put"), !external_change);
            assert_eq!(commands.contains("forward --remove"), !external_change);
            assert_eq!(
                commands.contains("reverse tcp:17890 tcp:18888"),
                !external_change
            );
            assert!(!manager.recovery_path().exists());
            if external_change {
                assert!(manager
                    .status()
                    .logs
                    .iter()
                    .any(|line| line.contains("changed outside Scope")));
            }
        }
    }
    #[test]
    fn owned_server_port_probe_distinguishes_listeners_from_other_connections() {
        let listening =
            " sl local_address rem_address st\n0: 0100007F:5E09 00000000:0000 0A 00000000:00000000";
        assert!(tcp_port_listening(listening, 24073));
        assert!(tcp_port_listening(
            "0: 00000000000000000000000001000000:5E09 00000000000000000000000000000000:0000 0A",
            24073
        ));
        assert!(!tcp_port_listening(
            "0: 0100007F:5E09 0100007F:8DC2 01",
            24073
        ));
        assert!(!tcp_port_listening(listening, 27042));
        assert!(!tcp_port_listening("malformed", 24073));
    }
    #[tokio::test]
    async fn worker_stdout_eof_after_ready_marks_capture_stopped() {
        let directory = tempfile::tempdir().unwrap();
        let manager = DeviceManager::new(directory.path().into());
        manager.inner.worker_generation.store(1, Ordering::SeqCst);
        manager.inner.status.lock().unwrap().running = true;
        let (mut writer, reader) = tokio::io::duplex(4096);
        let (sender, receiver) = oneshot::channel();
        let live = Arc::new(AtomicBool::new(true));
        let task = tokio::spawn(monitor_worker_output(
            manager.clone(),
            reader,
            1,
            live.clone(),
            sender,
        ));
        writer.write_all(b"{\"kind\":\"ready\"}\n").await.unwrap();
        assert!(receiver.await.unwrap().is_ok());
        drop(writer);
        task.await.unwrap();
        assert!(!live.load(Ordering::SeqCst));
        assert!(!manager.status().running);
        assert!(manager.status().message.contains("press Stop"));
    }
    #[tokio::test]
    async fn late_worker_eof_cannot_overwrite_a_new_session_status() {
        let directory = tempfile::tempdir().unwrap();
        let manager = DeviceManager::new(directory.path().into());
        manager.inner.worker_generation.store(2, Ordering::SeqCst);
        manager.inner.status.lock().unwrap().running = true;
        let (writer, reader) = tokio::io::duplex(4096);
        let (sender, _receiver) = oneshot::channel();
        let task = tokio::spawn(monitor_worker_output(
            manager.clone(),
            reader,
            1,
            Arc::new(AtomicBool::new(true)),
            sender,
        ));
        drop(writer);
        task.await.unwrap();
        assert!(manager.status().running);
    }
    #[tokio::test]
    async fn worker_detach_before_ready_reports_cause_without_waiting_for_eof() {
        let directory = tempfile::tempdir().unwrap();
        let manager = DeviceManager::new(directory.path().into());
        let (mut writer, reader) = tokio::io::duplex(4096);
        let (sender, receiver) = oneshot::channel();
        let task = tokio::spawn(monitor_worker_output(
            manager,
            reader,
            0,
            Arc::new(AtomicBool::new(true)),
            sender,
        ));
        writer
            .write_all(b"{\"kind\":\"detached\",\"message\":\"process-terminated\"}\n")
            .await
            .unwrap();
        let error = tokio::time::timeout(Duration::from_secs(1), receiver)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(error.contains("process-terminated"));
        drop(writer);
        task.await.unwrap();
    }
    #[test]
    fn android_server_abi_mapping_is_explicit() {
        assert_eq!(frida_arch("arm64-v8a\n"), Some("arm64"));
        assert_eq!(frida_arch("armeabi-v7a"), Some("arm"));
        assert_eq!(frida_arch("x86_64"), Some("x86_64"));
        assert_eq!(frida_arch("unknown;id"), None);
    }
    #[test]
    fn loads_recovery_status_without_claiming_live_capture() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("device-recovery.json"), "{}").unwrap();
        let manager = DeviceManager::new(directory.path().to_owned());
        assert!(!manager.status().running);
        assert!(manager.status().message.contains("cleanup"));
    }

    #[tokio::test]
    async fn disconnected_cleanup_retains_recovery_for_retry() {
        let directory = tempfile::tempdir().unwrap();
        let state = Recovery {
            serial: "emulator-5554".into(),
            package: "com.scope.demo".into(),
            mode: "proxy".into(),
            port: 17890,
            previous_proxy: Some(":0".into()),
            previous_reverse: None,
            forward_port: None,
            server_pid: None,
            ca_hash: None,
            root_shell: false,
        };
        let mut manager = DeviceManager::new(directory.path().to_owned());
        Arc::get_mut(&mut manager.inner).unwrap().adb = directory.path().join("missing-adb");
        manager.save_recovery(&state).unwrap();
        assert!(manager.stop().await.is_err());
        assert!(manager.recovery_path().exists());
        assert!(!manager.status().running);
        assert!(manager.status().message.contains("Cleanup incomplete"));
    }

    #[tokio::test]
    async fn malformed_saved_package_is_rejected_before_remote_shell() {
        let directory = tempfile::tempdir().unwrap();
        let manager = DeviceManager::new(directory.path().to_owned());
        let state = Recovery {
            serial: "emulator-5554".into(),
            package: "com.scope;touch /bad".into(),
            mode: "proxy".into(),
            port: 17890,
            previous_proxy: Some(":0".into()),
            previous_reverse: None,
            forward_port: None,
            server_pid: None,
            ca_hash: None,
            root_shell: false,
        };
        manager.save_recovery(&state).unwrap();
        let error = manager.stop().await.unwrap_err().to_string();
        assert!(error.contains("Invalid Android application ID"));
        assert!(manager.recovery_path().exists());
    }
}
