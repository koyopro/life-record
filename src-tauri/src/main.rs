// 配布物からは余分なコンソールを出さない（macOS では効かないが、他の OS で
// 動かしたときのために既定の形に合わせておく）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod url_rules;

use tauri::utils::config::FrontendDist;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use url_rules::{route, Route};

fn main() {
    tauri::Builder::default()
        // 外部 URL を macOS の既定のアプリへ渡すためだけに入れる。
        // 開くのは Rust 側だけなので、WebView へ権限は渡していない
        // （capabilities/default.json）。
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_url = app_url(app.handle())?;
            let handle = app.handle().clone();
            let origin = app_url.clone();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(app_url))
                .title("Life Record")
                .inner_size(1080.0, 820.0)
                .min_inner_size(400.0, 480.0)
                /*
                 * 移動の直前に呼ばれる。false を返すとその移動は起きない。
                 * 外部サイトが WebView の中に出ないのは、ここで止めているため。
                 */
                .on_navigation(move |url| match route(&origin, url) {
                    Route::InApp => true,
                    Route::Os => {
                        // 開く先は指定しない。macOS のユーザー設定（既定の
                        // ブラウザ・メールソフト）にそのまま従う
                        if let Err(error) = handle.opener().open_url(url.as_str(), None::<&str>) {
                            eprintln!("URL を開けなかった: {url} ({error})");
                        }
                        false
                    }
                    Route::Blocked => {
                        eprintln!("開かない URL: {url}");
                        false
                    }
                })
                .initialization_script(include_str!("open-external.js"))
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri アプリの起動に失敗した");
}

/// 表示する Life Record の URL。
///
/// Nitro の API が要るので、書き出した静的ファイルを同梱することはできない。
/// 開発は手元の dev サーバー（`build.devUrl`）、配布物はデプロイ先
/// （`build.frontendDist`）を指す。どちらも tauri.conf.json で決まる。
fn app_url(app: &AppHandle) -> Result<Url, Box<dyn std::error::Error>> {
    let build = &app.config().build;

    let url = if tauri::is_dev() {
        build.dev_url.clone()
    } else {
        match &build.frontend_dist {
            Some(FrontendDist::Url(url)) => Some(url.clone()),
            _ => None,
        }
    };

    url.ok_or_else(|| {
        "表示先の URL が無い。tauri.conf.json の build.frontendDist に \
         Life Record の URL を入れる（LIFE_RECORD_APP_URL でも差し替えられる）"
            .into()
    })
}
