// 配布物からは余分なコンソールを出さない（macOS では効かないが、他の OS で
// 動かしたときのために既定の形に合わせておく）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod url_rules;

use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
use tauri::utils::config::FrontendDist;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use url_rules::{route, Route};

/// 「再読み込み」のメニュー項目。押されたかを id で見分ける。
const RELOAD_MENU_ID: &str = "reload";

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
                /*
                 * ドラッグ＆ドロップは WebView（＝画面側）に任せる。
                 *
                 * Tauri は既定でドロップを横取りし、ファイルのパスを
                 * `tauri://drag-drop` として Rust 側へ送るだけになる。その間
                 * WebView には `drop` が届かないので、日記や作業記録の本文へ
                 * 画像を落としてもアップロードが始まらなかった
                 * （docs/16-macos-app.md 16.7）。
                 *
                 * 横取りをやめると macOS の既定の動き（WKWebView が受ける）に
                 * 戻り、ブラウザとまったく同じ経路で画像が上がる。パスを
                 * ネイティブ側で読む必要が無いので、WebView へファイルを読む
                 * 権限（16.5）を渡さずに済む。
                 */
                .disable_drag_drop_handler()
                .initialization_script(include_str!("open-external.js"))
                .build()?;

            app.set_menu(build_menu(app.handle())?)?;

            let window = app.get_webview_window("main");
            app.on_menu_event(move |_app, event| {
                if event.id() == RELOAD_MENU_ID {
                    if let Some(window) = &window {
                        if let Err(error) = window.reload() {
                            eprintln!("再読み込みできなかった: {error}");
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri アプリの起動に失敗した");
}

/// 「View > 再読み込み」（⌘R）を足したメニュー。
///
/// WebView にはブラウザのような再読み込みの導線が無く、Tauri の既定の
/// メニュー（`Menu::default`）にも入っていない。表示しているのは動いている
/// Nuxt そのものなので、読み込みに失敗したときに開き直せる入り口を1つ置く。
///
/// 既定のメニューを組み直さず、そこにある「View」へ足すだけにする。
/// 見当たらなければ（macOS 以外）自分で作る。
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let reload = MenuItem::with_id(app, RELOAD_MENU_ID, "再読み込み", true, Some("CmdOrCtrl+R"))?;

    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.text()? == "View" {
                submenu.prepend(&reload)?;
                return Ok(menu);
            }
        }
    }

    menu.append(&Submenu::with_items(app, "View", true, &[&reload])?)?;
    Ok(menu)
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
