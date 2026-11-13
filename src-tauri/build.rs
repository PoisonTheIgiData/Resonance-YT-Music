fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "res_win",
            "res_player_state",
            "res_set_close_to_tray",
            "res_dominant_color",
            "res_sign_out",
            "res_set_widget",
            "res_widget_cmd",
            "res_set_widget_layout",
            "res_set_pref",
            "res_get_prefs",
            "res_check_update",
            "res_install_update",
            "res_open_url",
            "res_lyrics",
            "res_discord",
            "res_set_hotkeys",
            "res_autostart",
            "res_notify",
            "res_translate", "res_devices", "res_bt_power", "res_set_output", "res_read_log", "res_release_notes", "res_set_overlay", "res_remote",
        ])),
    )
    .expect("failed to run tauri-build");
}
