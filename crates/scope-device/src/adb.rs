use anyhow::{bail, Context, Result};
use std::{
    collections::HashSet,
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::Command;

pub fn discover_adb() -> PathBuf {
    let binary = if cfg!(windows) { "adb.exe" } else { "adb" };
    if let Some(path) = env::var_os("SCOPE_ADB") {
        return path.into();
    }
    let mut roots: Vec<PathBuf> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .iter()
        .filter_map(env::var_os)
        .map(PathBuf::from)
        .collect();
    if let Some(home) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        roots.extend([home.join("Library/Android/sdk"), home.join("Android/Sdk")]);
    }
    if let Some(local) = env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Android/Sdk"));
    }
    roots
        .into_iter()
        .map(|root| root.join("platform-tools").join(binary))
        .find(|path| path.is_file())
        .unwrap_or_else(|| binary.into())
}

pub async fn run(adb: &Path, serial: Option<&str>, args: &[&str]) -> Result<String> {
    run_timeout(adb, serial, args, Duration::from_secs(35)).await
}

pub async fn run_timeout(
    adb: &Path,
    serial: Option<&str>,
    args: &[&str],
    timeout: Duration,
) -> Result<String> {
    let mut command = Command::new(adb);
    if let Some(serial) = serial {
        validate_serial(serial)?;
        command.args(["-s", serial]);
    }
    command.args(args).stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .with_context(|| format!("ADB command timed out after {} seconds", timeout.as_secs()))?
        .with_context(|| {
            format!(
                "Cannot run ADB at {}. Install Android platform-tools or set SCOPE_ADB",
                adb.display()
            )
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let detail = if stderr.is_empty() {
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        } else {
            stderr
        };
        bail!(
            "ADB {} failed: {}",
            args.first().unwrap_or(&"command"),
            detail
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

// ADB reconstructs shell arguments on the device. Only validated values or shell-quoted values
// may enter a remote command, even though no host shell is used.
pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn validate_serial(value: &str) -> Result<()> {
    if value.is_empty()
        || value.starts_with('-')
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._:-[]".contains(&c))
    {
        bail!("Invalid ADB device serial");
    }
    Ok(())
}

pub fn validate_package(value: &str) -> Result<()> {
    let mut parts = value.split('.');
    let count = value.split('.').count();
    if count < 2
        || !parts.all(|part| {
            !part.is_empty()
                && part.as_bytes()[0].is_ascii_alphabetic()
                && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        })
    {
        bail!("Invalid Android application ID");
    }
    Ok(())
}

pub fn parse_devices(text: &str) -> Vec<crate::Device> {
    text.lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 2
                || fields[0] == "List"
                || fields[0].starts_with('*')
                || validate_serial(fields[0]).is_err()
            {
                return None;
            }
            let model = fields
                .iter()
                .find_map(|field| field.strip_prefix("model:"))
                .unwrap_or(fields[0])
                .replace('_', " ");
            Some(crate::Device {
                serial: fields[0].into(),
                model,
                state: if fields[1] == "no" && fields.get(2) == Some(&"permissions") {
                    "no permissions".into()
                } else {
                    fields[1].into()
                },
                rooted: false,
            })
        })
        .collect()
}

pub fn parse_apps(packages: &str, processes: &str) -> Vec<crate::App> {
    let running: HashSet<_> = processes
        .lines()
        .filter_map(|line| line.split_whitespace().last())
        .map(|name| name.split(':').next().unwrap_or(name))
        .collect();
    let mut apps: Vec<_> = packages
        .lines()
        .filter_map(|line| {
            let package = line.trim().strip_prefix("package:")?;
            if validate_package(package).is_err() {
                return None;
            }
            Some(crate::App {
                package: package.into(),
                name: package.into(),
                running: running.contains(package),
            })
        })
        .collect();
    apps.sort_by(|a, b| a.package.cmp(&b.package));
    apps.dedup_by(|a, b| a.package == b.package);
    apps
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_online_offline_and_unauthorized_devices() {
        let devices = parse_devices("List of devices attached\nemulator-5554 device product:sdk model:Pixel_6a device:emu transport_id:1\nabc unauthorized usb:1\n192.168.1.4:5555 offline\n");
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].model, "Pixel 6a");
        assert_eq!(devices[1].state, "unauthorized");
        assert_eq!(devices[2].state, "offline");
    }
    #[test]
    fn packages_are_deduplicated_and_child_processes_mark_running() {
        let apps = parse_apps(
            "package:com.example.app\npackage:com.example.offline\npackage:com.example.app\n",
            "NAME\ncom.example.app:remote\n",
        );
        assert_eq!(apps.len(), 2);
        assert!(apps[0].running);
        assert!(!apps[1].running);
    }
    #[test]
    fn rejects_shell_injection_and_option_injection() {
        for package in [
            "com.example;id",
            "-n",
            "com.example$(id)",
            "com..app",
            "com.example/app",
            "com.example\napp",
        ] {
            assert!(validate_package(package).is_err(), "{package}");
        }
        for serial in ["-d", "a;id", "a b", "a\n"] {
            assert!(validate_serial(serial).is_err(), "{serial}");
        }
        assert!(validate_serial("192.168.0.1:5555").is_ok());
        assert!(validate_package("dev.scope.demo").is_ok());
        assert_eq!(quote("it's fine"), "'it'\\''s fine'");
    }
}
