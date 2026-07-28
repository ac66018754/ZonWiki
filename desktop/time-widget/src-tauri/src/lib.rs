// ZonWiki 時間追蹤 — Windows 桌面置頂小工具（Tauri 後端）。
//
// 設計：所有對 ZonWiki API 的 HTTP 都在 Rust 端發（reqwest），前端只透過 invoke 呼叫命令——
// 好處是完全繞過 WebView 的 CORS（不必在後端為桌面來源開 CORS），且 PAT 只存在本機設定檔、
// 不寫死在程式碼。設定（BASE 網址＋PAT）存於作業系統的 app config 目錄下 config.json。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::Manager;

/// 使用者設定：ZonWiki 站台網址與個人存取權杖（PAT）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AppConfig {
    /// ZonWiki 站台基底網址（例如 https://zonwiki.pee-yang.com 或 http://localhost:5009）。
    #[serde(default)]
    base: String,
    /// 個人存取權杖（Bearer）。
    #[serde(default)]
    token: String,
}

/// 取得設定檔路徑（app config 目錄下的 config.json）；必要時建立目錄。
fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("找不到設定目錄：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("無法建立設定目錄：{e}"))?;
    Ok(dir.join("config.json"))
}

/// 讀取設定；檔案不存在時回傳空設定（base/token 皆為空字串）。
#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("讀取設定失敗：{e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("設定格式錯誤：{e}"))
}

/// 儲存設定（base 去尾斜線、token 去前後空白）。
#[tauri::command]
fn save_config(app: tauri::AppHandle, base: String, token: String) -> Result<(), String> {
    let config = AppConfig {
        base: base.trim().trim_end_matches('/').to_string(),
        token: token.trim().to_string(),
    };
    let path = config_path(&app)?;
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("寫入設定失敗：{e}"))
}

/// 建立帶 Bearer 授權標頭的 reqwest 客戶端與已驗證的設定（base/token 皆非空）。
fn client_and_config(app: &tauri::AppHandle) -> Result<(reqwest::Client, AppConfig), String> {
    let config = load_config(app.clone())?;
    if config.base.is_empty() || config.token.is_empty() {
        return Err("尚未設定站台網址或權杖，請先開設定填入".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP 客戶端建立失敗：{e}"))?;
    Ok((client, config))
}

/// 統一解析 ZonWiki 的 `{ success, data, error }` 信封：成功回 data，失敗回 error 訊息。
async fn unwrap_envelope(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("回應解析失敗（HTTP {status}）：{e}"))?;
    if body.get("success").and_then(Value::as_bool) == Some(true) {
        Ok(body.get("data").cloned().unwrap_or(Value::Null))
    } else {
        let msg = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("請求失敗")
            .to_string();
        Err(format!("{msg}（HTTP {status}）"))
    }
}

/// 列出目前進行中的計時項目（GET /api/time-entries/running）。
#[tauri::command]
async fn list_running(app: tauri::AppHandle) -> Result<Value, String> {
    let (client, config) = client_and_config(&app)?;
    let response = client
        .get(format!("{}/api/time-entries/running", config.base))
        .bearer_auth(&config.token)
        .send()
        .await
        .map_err(|e| format!("連線失敗：{e}"))?;
    unwrap_envelope(response).await
}

/// 建立並開始一筆計時（POST /api/time-entries）。分類／備註為空字串時不送。
#[tauri::command]
async fn create_entry(
    app: tauri::AppHandle,
    title: String,
    category: Option<String>,
    note: Option<String>,
) -> Result<Value, String> {
    let (client, config) = client_and_config(&app)?;
    let mut payload = serde_json::Map::new();
    payload.insert("title".into(), Value::String(title));
    if let Some(category) = category.filter(|value| !value.trim().is_empty()) {
        payload.insert("category".into(), Value::String(category));
    }
    if let Some(note) = note.filter(|value| !value.trim().is_empty()) {
        payload.insert("note".into(), Value::String(note));
    }
    let response = client
        .post(format!("{}/api/time-entries", config.base))
        .bearer_auth(&config.token)
        .json(&Value::Object(payload))
        .send()
        .await
        .map_err(|e| format!("連線失敗：{e}"))?;
    unwrap_envelope(response).await
}

/// 結束指定計時（POST /api/time-entries/{id}/stop）。
#[tauri::command]
async fn stop_entry(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let (client, config) = client_and_config(&app)?;
    let response = client
        .post(format!("{}/api/time-entries/{}/stop", config.base, id))
        .bearer_auth(&config.token)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| format!("連線失敗：{e}"))?;
    unwrap_envelope(response).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            list_running,
            create_entry,
            stop_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
