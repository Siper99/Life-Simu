// API key 存 Windows 凭据管理器（keyring），settings.json 里只留空占位，避免明文落盘。
const SECRET_SERVICE: &str = "life-sim";

/// profile_id 是前端生成的固定格式（`p-<时间戳>-<随机>`）。这里做白名单校验，
/// 拒绝异常长度或含特殊字符的标识符，避免被拿去探测/污染凭据库的其它条目。
fn validate_profile_id(profile_id: &str) -> Result<(), String> {
    if profile_id.len() < 3 || profile_id.len() > 64 {
        return Err("非法的 profile_id：长度超出范围".into());
    }
    if !profile_id.starts_with("p-") {
        return Err("非法的 profile_id：前缀不符".into());
    }
    if !profile_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("非法的 profile_id：含非法字符".into());
    }
    Ok(())
}

fn entry_for(profile_id: &str) -> Result<keyring::Entry, String> {
    validate_profile_id(profile_id)?;
    keyring::Entry::new(SECRET_SERVICE, profile_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_set(profile_id: String, value: String) -> Result<(), String> {
    let entry = entry_for(&profile_id)?;
    if value.is_empty() {
        // 空值视为删除，避免凭据库残留
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(profile_id: String) -> Result<String, String> {
    let entry = entry_for(&profile_id)?;
    match entry.get_password() {
        Ok(v) => Ok(v),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(profile_id: String) -> Result<(), String> {
    let entry = entry_for(&profile_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // updater 仅桌面端可用
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![secret_set, secret_get, secret_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
