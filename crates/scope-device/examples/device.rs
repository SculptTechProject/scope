//! Low-level adapter smoke test. Start only affects the explicitly selected device/app.
use anyhow::{bail, Context, Result};
use scope_device::DeviceManager;
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::main]
async fn main() -> Result<()> {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    let runtime = std::env::var_os("SCOPE_DEVICE_RUNTIME")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("scope-device-smoke"));
    let manager = DeviceManager::new(runtime);
    match arguments.first().map(String::as_str) {
        Some("devices") => println!("{}", serde_json::to_string_pretty(&manager.list_devices().await?)?),
        Some("apps") => println!("{}", serde_json::to_string_pretty(&manager.list_apps(arguments.get(1).context("Missing serial")?).await?)?),
        Some("stop") => println!("{}", serde_json::to_string_pretty(&manager.stop().await?)?),
        Some("start") => {
            if arguments.len() != 6 { bail!("start <serial> <package> <mode:proxy|frida> <proxy-port> <ca.pem>"); }
            let status = manager.start(arguments[1].clone(), arguments[2].clone(), arguments[3].clone(), arguments[4].parse()?, arguments[5].clone().into(), vec![]).await?;
            println!("{}", serde_json::to_string_pretty(&status)?);
            eprintln!("Press Enter to stop and restore the device settings.");
            let mut input = String::new();
            BufReader::new(tokio::io::stdin()).read_line(&mut input).await?;
            println!("{}", serde_json::to_string_pretty(&manager.stop().await?)?);
        }
        _ => bail!("Usage: device devices | apps <serial> | start <serial> <package> <mode> <port> <ca.pem> | stop"),
    }
    Ok(())
}
