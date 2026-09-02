// 配布物からは余分なコンソールを出さない（macOS では効かないが、他の OS で
// 動かしたときのために既定の形に合わせておく）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod url_rules;

use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::utils::config::FrontendDist;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use url_rules::{handoff, route, Route};

/// メニューの項目。押されたかを id で見分ける。
const RELOAD_MENU_ID: &str = "reload";
const NEW_TAB_MENU_ID: &str = "new-tab";
const NEXT_TAB_MENU_ID: &str = "next-tab";
const PREVIOUS_TAB_MENU_ID: &str = "previous-tab";

/// 同じタブ群にまとめるための印（docs/16-macos-app.md 16.10）。
#[cfg(target_os = "macos")]
const TABBING_IDENTIFIER: &str = "life-record";

/// ウィンドウ（＝タブ）の名前に使う通し番号。名前は重ねられない。
static NEXT_TAB_NUMBER: AtomicUsize = AtomicUsize::new(1);

fn main() {
    tauri::Builder::default()
        // 外部 URL を macOS の既定のアプリへ渡すためだけに入れる。
        // 開くのは Rust 側だけなので、WebView へ権限は渡していない
        // （capabilities/default.json）。
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            open_tab(&handle, app_url(&handle)?)?;

            app.set_menu(build_menu(&handle)?)?;
            app.on_menu_event(|app, event| {
                let id = event.id();
                if id == RELOAD_MENU_ID {
                    reload_tab(app);
                } else if id == NEW_TAB_MENU_ID {
                    new_tab(app);
                } else if id == NEXT_TAB_MENU_ID {
                    select_tab(app, Direction::Next);
                } else if id == PREVIOUS_TAB_MENU_ID {
                    select_tab(app, Direction::Previous);
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri アプリの起動に失敗した")
        .run(|app, event| {
            /*
             * Dock のアイコンを押した（applicationShouldHandleReopen。macOS だけ）。
             *
             * `⌘W` で最後のタブまで閉じると、アプリは残るがウィンドウが無くなる。
             * macOS の作法どおり、ここから開き直せるようにする。
             */
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);

            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                new_tab(app);
            }
        });
}

/// 新しいタブ（＝ウィンドウ）を1つ開く。行き先はアプリの先頭。
fn new_tab(app: &AppHandle) {
    if let Err(error) = app_url(app).and_then(|url| open_tab(app, url)) {
        eprintln!("タブを開けなかった: {error}");
    }
}

/// 前面のタブを読み込み直す（View > 再読み込み）。
///
/// タブごとに別の WebView なので、掴むのは**いま前面にあるもの**。
fn reload_tab(app: &AppHandle) {
    let Some(window) = focused_tab(app) else {
        return;
    };
    if let Err(error) = window.reload() {
        eprintln!("再読み込みできなかった: {error}");
    }
}

/// いま前面にあるタブ。どれも前面でなければ None。
///
/// タブごとに別の WebView なので、掴む相手を決め打ちにできない。
fn focused_tab(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
}

/// タブを移る向き。
#[derive(Clone, Copy)]
enum Direction {
    Next,
    Previous,
}

/**
 * URL を1つのタブ（＝ウィンドウ）で開く。
 *
 * 1タブ = 1ウィンドウ = 1 WebView にして、**タブとしてのまとまりは macOS に
 * 任せる**（docs/16-macos-app.md 16.10）。画面側には何も足さずに済み、タブの
 * 並べ替えや「タブを新しいウィンドウへ」も OS のものがそのまま使える。
 *
 * 設定はどのタブでも同じにする。移動の判定（on_navigation）も、画面へ入れる
 * スクリプトも、タブごとに要るため。
 */
fn open_tab(app: &AppHandle, url: Url) -> Result<(), Box<dyn std::error::Error>> {
    let origin = app_url(app)?;
    let handle = app.clone();
    let label = format!("tab-{}", NEXT_TAB_NUMBER.fetch_add(1, Ordering::Relaxed));

    // 新しいタブは、いま前面にあるタブの隣へ入れる（作る前に控えておく）
    let current = focused_tab(app);

    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title("Life Record")
        .inner_size(1080.0, 820.0)
        .min_inner_size(400.0, 480.0)
        /*
         * 移動の直前に呼ばれる。false を返すとその移動は起きない。
         * 外部サイトが WebView の中に出ないのは、ここで止めているため。
         */
        .on_navigation(move |url| decide(&handle, &origin, url))
        /*
         * タブの見出しは、その画面の題にする（ブラウザのタブと同じ）。
         *
         * ネイティブのウィンドウの題は、作るときに決めたまま変わらない。
         * タブを並べたときに全部「Life Record」では、どれがどれだか分からない。
         */
        .on_document_title_changed(|window, title| {
            if let Err(error) = window.set_title(&title) {
                eprintln!("タブの見出しを変えられなかった: {error}");
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
        .initialization_script(include_str!("open-external.js"));

    #[cfg(target_os = "macos")]
    let builder = builder.tabbing_identifier(TABBING_IDENTIFIER);

    let window = builder.build()?;
    attach_as_tab(current, &window);

    Ok(())
}

/// 移動をどう扱うか決める（`on_navigation`）。true なら WebView の中で移る。
fn decide(app: &AppHandle, origin: &Url, url: &Url) -> bool {
    /*
     * 画面から「別のところで開きたい」と渡された分（`open-external.js`）。
     * 1つずつ判定にかけ、外部は OS へ、アプリの中の URL は新しいタブへ回す。
     * 入れ物の URL そのものへは移動しない。
     */
    if let Some(targets) = handoff(origin, url) {
        for target in targets {
            match route(origin, &target) {
                Route::Os => open_in_os(app, &target),
                Route::InApp => open_in_new_tab(app, target),
                Route::Blocked => eprintln!("開かない URL: {target}"),
            }
        }
        return false;
    }

    match route(origin, url) {
        Route::InApp => true,
        Route::Os => {
            open_in_os(app, url);
            false
        }
        Route::Blocked => {
            eprintln!("開かない URL: {url}");
            false
        }
    }
}

/// macOS の既定のアプリ（ブラウザ・メールなど）で開く。
///
/// 開く先は指定しない。ユーザーの設定にそのまま従う。
fn open_in_os(app: &AppHandle, url: &Url) {
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("URL を開けなかった: {url} ({error})");
    }
}

/// アプリの中の URL を、新しいタブで開く。
///
/// 判定（`decide`）の中では作らず、いったん返事を返してから作る。新しいタブも
/// 最初の移動でこの判定を通るので、問い合わせの途中でさらに問い合わせが
/// 起きるのを避ける。
fn open_in_new_tab(app: &AppHandle, url: Url) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Err(error) = open_tab(&handle, url) {
            eprintln!("タブを開けなかった: {error}");
        }
    }) {
        eprintln!("タブを開けなかった: {error}");
    }
}

/**
 * 新しいウィンドウを、いま前面のタブの隣へ差し込む（macOS）。
 *
 * `tabbing_identifier` を付けるだけではタブにならない。tao は tabbingMode を
 * `automatic` のままにするため、macOS の「書類を開くときはタブを使用」が既定
 * （フルスクリーンのときのみ）だと**別ウィンドウとして開いてしまう**。
 * AppKit に直に頼んで、設定に関わらずタブとして入れる。
 */
#[cfg(target_os = "macos")]
fn attach_as_tab(current: Option<WebviewWindow>, new: &WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    // 1つ目のタブは、隣に入れる相手がいない
    let Some(current) = current else { return };
    let (Ok(current), Ok(new)) = (current.ns_window(), new.ns_window()) else {
        return;
    };

    let current = current as *mut AnyObject;
    let new = new as *mut AnyObject;

    // NSWindowAbove（1）＝ いまのタブのすぐ次に並べる
    unsafe {
        let _: () = msg_send![current, addTabbedWindow: new, ordered: 1isize];
    }
}

#[cfg(not(target_os = "macos"))]
fn attach_as_tab(_current: Option<WebviewWindow>, _new: &WebviewWindow) {}

/**
 * 隣のタブへ移る（`⌘⇧]` / `⌘⇧[`）。
 *
 * 並べ替えたあとの**見た目どおりの順**で回したいので、AppKit の
 * `selectNextTab:` / `selectPreviousTab:` に任せる。自分で順番を持つと、
 * タブをドラッグして入れ替えたときにずれる。
 */
#[cfg(target_os = "macos")]
fn select_tab(app: &AppHandle, direction: Direction) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let Some(window) = focused_tab(app) else {
        return;
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };

    let ns_window = ns_window as *mut AnyObject;
    let sender = std::ptr::null_mut::<AnyObject>();

    unsafe {
        match direction {
            Direction::Next => {
                let _: () = msg_send![ns_window, selectNextTab: sender];
            }
            Direction::Previous => {
                let _: () = msg_send![ns_window, selectPreviousTab: sender];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn select_tab(_app: &AppHandle, _direction: Direction) {}

/**
 * 既定のメニューに、この入れ物のぶんを足したもの。
 *
 * | 場所 | 項目 | 打鍵 |
 * |---|---|---|
 * | File | 新規タブ | `⌘T` |
 * | View | 再読み込み | `⌘R` |
 * | Window | 次のタブ / 前のタブ | `⌘⇧]` / `⌘⇧[` |
 *
 * 再読み込みは、WebView にブラウザのような導線が無く、Tauri の既定の
 * メニュー（`Menu::default`）にも入っていないため。タブの移動は、macOS が
 * 自動で足す `⌃⇥` とは別に、ブラウザと同じ打鍵を用意する。
 *
 * 既定のメニューは組み直さず、そこにある入れ物へ足すだけにする（標準の
 * 項目をそのまま残すため）。「View」だけは見当たらなければ（macOS 以外）
 * 自分で作る。
 */
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;

    let new_tab = MenuItem::with_id(app, NEW_TAB_MENU_ID, "新規タブ", true, Some("CmdOrCtrl+T"))?;
    let reload = MenuItem::with_id(app, RELOAD_MENU_ID, "再読み込み", true, Some("CmdOrCtrl+R"))?;
    let next_tab = MenuItem::with_id(
        app,
        NEXT_TAB_MENU_ID,
        "次のタブ",
        true,
        Some("CmdOrCtrl+Shift+]"),
    )?;
    let previous_tab = MenuItem::with_id(
        app,
        PREVIOUS_TAB_MENU_ID,
        "前のタブ",
        true,
        Some("CmdOrCtrl+Shift+["),
    )?;

    let mut has_view = false;

    for item in menu.items()? {
        let MenuItemKind::Submenu(submenu) = item else {
            continue;
        };

        match submenu.text()?.as_str() {
            "File" => submenu.prepend(&new_tab)?,
            "View" => {
                has_view = true;
                submenu.prepend(&reload)?;
            }
            "Window" => {
                submenu.append(&PredefinedMenuItem::separator(app)?)?;
                submenu.append(&next_tab)?;
                submenu.append(&previous_tab)?;
            }
            _ => {}
        }
    }

    if !has_view {
        menu.append(&Submenu::with_items(app, "View", true, &[&reload])?)?;
    }

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
