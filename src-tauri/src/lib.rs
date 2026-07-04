mod binaries;
mod download;
mod export;
mod media;

use tauri_plugin_sql::{Migration, MigrationKind};

pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "local clip-cutter schema",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cliply-exporter.db", migrations)
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("cliply-exporter".into()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init());

    // Self-update (check → download → relaunch) is desktop-only.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .manage(download::DownloadState::default())
        .manage(export::ExportState::default())
        .invoke_handler(tauri::generate_handler![
            binaries::binaries_status,
            binaries::download_binaries,
            download::download_youtube,
            download::download_url,
            download::cancel_download,
            media::read_xml_file,
            media::generate_poster,
            media::copy_file,
            media::probe_media,
            media::delete_media,
            export::export_clips,
            export::cancel_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
