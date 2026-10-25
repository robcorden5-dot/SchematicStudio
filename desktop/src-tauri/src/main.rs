// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The app is the website's editor in a native window. All of its logic is JavaScript (src/); this side only supplies the
// window and three plugins: file access (projects and libraries are files on disk), save/open dialogs, and "open a link in the
// system browser".
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running SchematicStudio");
}
