//! WebView が開こうとした URL を、どこで開くかの判定。
//!
//! 判定はここ（Rust 側）だけが持つ。WebView からは「移動しようとした」と
//! いう事実しか渡ってこないので、任意の URL をネイティブ API に流し込める
//! 経路を作らずに済む（docs/16-macos-app.md 16.4）。

use url::Url;

/// URL の行き先。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// Life Record 自身。Tauri のウィンドウの中で開く
    InApp,
    /// 外部。macOS の既定のアプリ（ブラウザ・メールなど）へ渡す
    Os,
    /// どちらでも開かない
    Blocked,
}

/// OS へ渡すスキーム。
///
/// 「http 以外はすべて OS へ」とはしない。`file:` や見知らぬ独自スキームまで
/// 渡すと、リンクを踏んだだけで手元のファイルや別のアプリを起こせてしまう。
/// 本文に書きうるものだけを挙げる。
const OS_SCHEMES: [&str; 5] = ["mailto", "tel", "sms", "facetime", "facetime-audio"];

/// WebView が自分のために使うスキーム。素通しする。
const IN_APP_SCHEMES: [&str; 3] = ["tauri", "asset", "about"];

/// 認証のために経由する host。別 origin だがアプリの中で開く。
///
/// デプロイ先を Vercel の Deployment Protection で守っているため、最初の
/// 移動は `https://vercel.com/sso-api?…` へリダイレクトされる
/// （docs/16-macos-app.md 16.1）。ここをブラウザへ渡すと認証 Cookie が
/// ブラウザ側に付いてしまい、WebView は何度起動しても白いままになる。
/// 認証をアプリの中で終わらせるために、この host だけ例外として通す。
const AUTH_HOSTS: [&str; 1] = ["vercel.com"];

/// `target` をどこで開くか。`app` は Life Record 自身の URL。
pub fn route(app: &Url, target: &Url) -> Route {
    let scheme = target.scheme();

    if scheme == "http" || scheme == "https" {
        if same_origin(app, target) {
            return Route::InApp;
        }
        // 認証の経由先だけは別 origin でも中で開く。盗み見られると認証が
        // そのまま通るので、https で来たものに限る
        if scheme == "https" && is_auth_host(target) {
            return Route::InApp;
        }
        return Route::Os;
    }

    if OS_SCHEMES.contains(&scheme) {
        return Route::Os;
    }

    if IN_APP_SCHEMES.contains(&scheme) {
        return Route::InApp;
    }

    Route::Blocked
}

/// 同じ origin か（スキーム・ホスト・ポートが一致するか）。
///
/// 開発は `http://localhost:3000`、配布物は `https://<デプロイ先>` を指す。
/// どちらの場合も、その1つだけをアプリの中とみなす。
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// 認証のために通す host か。
///
/// 完全一致でみる。副ドメイン（`foo.vercel.com`）まで許すと、Vercel に
/// 置かれた他人のサイトまでアプリの中で開けてしまう。
fn is_auth_host(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|host| AUTH_HOSTS.contains(&host))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> Url {
        Url::parse("https://life-record.example.com").unwrap()
    }

    fn route_str(target: &str) -> Route {
        route(&app(), &Url::parse(target).unwrap())
    }

    /// 同じ origin はアプリの中で開く
    #[test]
    fn same_origin_opens_in_app() {
        assert_eq!(
            route_str("https://life-record.example.com/today"),
            Route::InApp
        );
        assert_eq!(
            route_str("https://life-record.example.com/items/1?selected=2#a"),
            Route::InApp
        );
        // 既定のポートを書いても同じ origin
        assert_eq!(
            route_str("https://life-record.example.com:443/"),
            Route::InApp
        );
    }

    /// 別の origin は OS へ渡す
    #[test]
    fn other_origin_goes_to_os() {
        assert_eq!(route_str("https://example.com/"), Route::Os);
        assert_eq!(route_str("http://life-record.example.com/"), Route::Os);
        assert_eq!(
            route_str("https://life-record.example.com:8443/"),
            Route::Os
        );
        // ホスト名の後ろに足しただけの紛らわしいもの
        assert_eq!(
            route_str("https://life-record.example.com.evil.test/"),
            Route::Os
        );
    }

    /// 開発時は localhost がアプリの中
    #[test]
    fn dev_url_is_in_app() {
        let dev = Url::parse("http://localhost:3000").unwrap();
        let inside = Url::parse("http://localhost:3000/diary/2026-08-22").unwrap();
        let other = Url::parse("http://localhost:5173/").unwrap();
        assert_eq!(route(&dev, &inside), Route::InApp);
        assert_eq!(route(&dev, &other), Route::Os);
    }

    /// Vercel の認証はアプリの中で通す（別 origin だが例外）
    #[test]
    fn auth_host_opens_in_app() {
        assert_eq!(
            route_str("https://vercel.com/sso-api?url=https%3A%2F%2Fexample.com%2F&nonce=abc"),
            Route::InApp
        );
        assert_eq!(
            route_str("https://vercel.com/login?next=%2Fsso-api"),
            Route::InApp
        );
    }

    /// 認証の例外は vercel.com そのものだけ
    #[test]
    fn auth_host_exception_is_narrow() {
        // 副ドメインは含めない。他人のデプロイ先まで中で開いてしまう
        assert_eq!(route_str("https://other-app.vercel.com/"), Route::Os);
        // ホスト名の後ろに足しただけの紛らわしいもの
        assert_eq!(route_str("https://vercel.com.evil.test/"), Route::Os);
        // http では通さない
        assert_eq!(route_str("http://vercel.com/sso-api"), Route::Os);
    }

    /// メールと電話は OS へ渡す
    #[test]
    fn mailto_and_tel_go_to_os() {
        assert_eq!(route_str("mailto:someone@example.com"), Route::Os);
        assert_eq!(route_str("tel:+81312345678"), Route::Os);
    }

    /// 手元のファイルや見知らぬ独自スキームは開かない
    #[test]
    fn unknown_schemes_are_blocked() {
        assert_eq!(route_str("file:///etc/passwd"), Route::Blocked);
        assert_eq!(route_str("javascript:alert(1)"), Route::Blocked);
        assert_eq!(
            route_str("data:text/html,<script>alert(1)</script>"),
            Route::Blocked
        );
        assert_eq!(route_str("x-unknown-app://run"), Route::Blocked);
    }

    /// WebView 自身のスキームは素通しする
    #[test]
    fn webview_schemes_pass_through() {
        assert_eq!(route_str("about:blank"), Route::InApp);
        assert_eq!(route_str("tauri://localhost/"), Route::InApp);
    }
}
